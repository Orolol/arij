import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  epics,
  projects,
  ticketComments,
} from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { agentScheduler } from "@/lib/agents/scheduler";
import { processManager } from "@/lib/claude/process-manager";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import {
  createQueuedSession,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";
import {
  classifySessionOutcome,
  extractSessionUsage,
  resolveSessionOutput,
} from "@/lib/claude/resolve-session-output";
import {
  isResumableProvider,
  providerReportsOwnSessionId,
} from "@/lib/agent-sessions/resume-capability";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { createWorktree, mergeWorktree } from "@/lib/git/manager";
import { tryExportArjiJson } from "@/lib/sync/export";
import { applyTransition } from "@/lib/workflow/transition-service";
import { logTransition } from "@/lib/workflow/log";
import { createAutoModeMergeParkedNotification } from "@/lib/notifications/create";
import type { KanbanStatus } from "@/lib/types/kanban";
import { AUTO_MODE_REASONS, autoRunId } from "./constants";
import { autoModeRegistry } from "./registry";

/**
 * Full Auto Mode's merge step — the one place the mode touches `main`.
 *
 * The critical design constraint: "the review is OK" exists nowhere as a
 * boolean, and this module does NOT invent one. The workflow engine's
 * `review → done` guards ARE the gate: `applyTransition` refuses unless a
 * review session completed and no review comment is still open
 * (lib/workflow/engine.ts:51-63). The supervisor simply attempts the
 * transition and treats a refusal as "not ready — skip, try again later".
 *
 * `POST .../approve` is deliberately NOT reused: it bulk-resolves every open
 * review comment before transitioning (approve/route.ts:30-38), which would
 * steamroll exactly the blocking findings that must stop an auto-merge.
 *
 * A clean merge is pure git — no agent session, no scheduler slot. Only a
 * CONFLICT costs an agent (a `merge` session dispatched through the same
 * scheduler as everything else, counted by the caller against the build
 * budget), and only once: if the retry after the merge-fix agent still
 * fails, the epic is parked and the user is notified rather than looped on.
 */

export type AutoMergeOutcome =
  | { status: "merged"; commitHash: string | null; sessionId: null }
  | {
      /** A guard refused, or the epic is not mergeable right now. Not a failure. */
      status: "skipped";
      reason: string;
      sessionId: null;
    }
  | {
      /** Git conflicted; a merge-fix agent was dispatched and will retry once. */
      status: "conflict";
      error: string;
      sessionId: string;
    }
  | {
      /** Merge failed and no agent could be dispatched — counts as a failure. */
      status: "failed";
      error: string;
      sessionId: null;
    };

export interface TryAutoMergeOptions {
  /**
   * Named agent for the merge-fix session. Full Auto Mode passes its
   * configured build agent — a conflict resolution is code work, and it is
   * charged to the build budget.
   */
  namedAgentId?: string | null;
  /**
   * Whether a conflict may spend a build slot on a resolution agent. The
   * caller decides, because only it knows how much of the build budget is
   * left — and a merge-fix session IS a build. False turns a conflict into a
   * plain "skipped", retried on the next sweep once a slot frees. Defaults to
   * true so a direct call still self-heals.
   */
  dispatchConflictAgent?: boolean;
}

const MERGE_ALLOWED_TOOLS = ["Edit", "Write", "Bash", "Read", "Glob", "Grep"];

/** Worktree of the epic's most recent session — the merge route's lookup. */
function findWorktreePath(
  projectId: string,
  epicId: string
): string | undefined {
  const session = db
    .select({ worktreePath: agentSessions.worktreePath })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.epicId, epicId),
        eq(agentSessions.projectId, projectId)
      )
    )
    .orderBy(agentSessions.createdAt)
    .all()
    .pop();
  return session?.worktreePath || undefined;
}

/**
 * Moves a merged epic to done through the transition service, then clears
 * its branch and re-exports arji.json — the merge route's success block
 * (merge/route.ts:77-102), shared by the direct merge and the post-merge-fix
 * retry.
 *
 * The `fromStatus` is RE-READ here rather than carried in from before the
 * merge. `mergeWorktree` takes real seconds, and anything can happen in that
 * window: a human drags the ticket, or the review stage that was settling
 * when the merge started bounces the epic back to `in_progress`. Validating
 * `review → done` against a stale snapshot would rubber-stamp exactly the
 * transition the engine exists to refuse.
 *
 * On refusal the branch is still cleared — `mergeWorktree` deleted it on the
 * way out, so leaving the name behind would make every later sweep try to
 * merge a branch that no longer exists.
 */
function finalizeMergedEpic(input: {
  projectId: string;
  epicId: string;
  sessionId?: string;
  reason: string;
}): { ok: true } | { ok: false; error: string } {
  const current = db
    .select({ status: epics.status })
    .from(epics)
    .where(eq(epics.id, input.epicId))
    .get();
  const fromStatus = (current?.status ?? "review") as KanbanStatus;

  const validation = applyTransition({
    projectId: input.projectId,
    epicId: input.epicId,
    fromStatus,
    toStatus: "done",
    actor: "agent",
    source: "merge",
    reason: input.reason,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    // The branch clear below belongs to the same write, so the transition
    // service validates/emits/logs but leaves the row to us.
    skipDbUpdate: true,
  });

  if (!validation.valid) {
    const error = validation.error ?? "Transition refused";
    db.update(epics)
      .set({ branchName: null, updatedAt: new Date().toISOString() })
      .where(eq(epics.id, input.epicId))
      .run();
    logTransition({
      projectId: input.projectId,
      epicId: input.epicId,
      fromStatus,
      toStatus: fromStatus,
      actor: "system",
      reason: AUTO_MODE_REASONS.mergedButNotAdvanced(error),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    return { ok: false, error };
  }

  db.update(epics)
    .set({
      status: "done",
      branchName: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(epics.id, input.epicId))
    .run();

  tryExportArjiJson(input.projectId);
  return { ok: true };
}

/**
 * Attempts to land one epic's branch.
 *
 * Order of operations differs from the human merge route in one deliberate
 * way: the workflow guards are validated BEFORE git runs, not after. The
 * route can afford to merge first and 400 afterwards because a human is
 * reading the error; unattended, a merge that lands on main while the ticket
 * refuses to move would leave the board lying about `main`.
 */
export async function tryAutoMerge(
  projectId: string,
  epicId: string,
  options: TryAutoMergeOptions = {}
): Promise<AutoMergeOutcome> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project?.gitRepoPath) {
    return {
      status: "skipped",
      reason: "Project has no git repository configured",
      sessionId: null,
    };
  }

  const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!epic) {
    return { status: "skipped", reason: "Epic not found", sessionId: null };
  }
  if (!epic.branchName) {
    return {
      status: "skipped",
      reason: "Epic has no branch to merge",
      sessionId: null,
    };
  }

  const fromStatus = (epic.status ?? "review") as KanbanStatus;

  // Pre-flight the workflow guards. A refusal here is the "review is not
  // actually OK" answer (no completed review, or an open review comment) —
  // logged and skipped, never parked: the epic becomes mergeable again the
  // moment the user resolves the comment.
  const preflight = applyTransition({
    projectId,
    epicId,
    fromStatus,
    toStatus: "done",
    actor: "agent",
    source: "merge",
    validateOnly: true,
  });
  if (!preflight.valid) {
    const reason = preflight.error ?? "Transition refused";
    logTransition({
      projectId,
      epicId,
      fromStatus,
      toStatus: fromStatus,
      actor: "system",
      reason: AUTO_MODE_REASONS.mergeRefused(reason),
    });
    return { status: "skipped", reason, sessionId: null };
  }

  const worktreePath = findWorktreePath(projectId, epicId);
  const result = await mergeWorktree(
    project.gitRepoPath,
    epic.branchName,
    worktreePath
  );

  if (result.merged) {
    const finalized = finalizeMergedEpic({
      projectId,
      epicId,
      reason: AUTO_MODE_REASONS.merged,
    });
    if (!finalized.ok) {
      // The guards passed pre-flight and refused post-merge — the epic moved
      // under us. The branch is already on main; report it as skipped so the
      // epic is not parked, and let the next sweep settle the board.
      return { status: "skipped", reason: finalized.error, sessionId: null };
    }
    autoModeRegistry.clearFailures(projectId, epicId);
    autoModeRegistry.recordDispatch(projectId, {
      kind: "merge",
      epicId,
      userStoryId: null,
      sessionId: null,
      detail: result.commitHash ?? null,
    });
    return {
      status: "merged",
      commitHash: result.commitHash ?? null,
      sessionId: null,
    };
  }

  const error = result.error || "Merge failed";

  // A merge-fix session is a build. Without a build slot to charge it to,
  // the conflict simply waits for the next sweep — better than blowing
  // through the budget the user set (or dispatching at all when they set
  // build concurrency to 0, which means "run no code agents").
  if (options.dispatchConflictAgent === false) {
    return {
      status: "skipped",
      reason: `${error} — no build capacity for a resolution agent`,
      sessionId: null,
    };
  }

  // `mergeWorktree` removes the epic's worktree BEFORE it attempts the merge
  // (lib/git/manager.ts:95), and the conflict path aborts without putting it
  // back — so the directory the agent is supposed to work in no longer
  // exists. The branch does survive (it is only deleted after a successful
  // merge), and `createWorktree` re-attaches a worktree to an existing
  // branch, so this restores exactly the tree the agent needs.
  let conflictWorktreePath: string;
  try {
    conflictWorktreePath = (
      await createWorktree(project.gitRepoPath, epicId, epic.title)
    ).worktreePath;
  } catch (worktreeError) {
    console.warn(
      "[auto-mode/merge] Could not restore the worktree for conflict resolution:",
      worktreeError instanceof Error ? worktreeError.message : worktreeError
    );
    return { status: "failed", error, sessionId: null };
  }

  const sessionId = await dispatchMergeFixAgent({
    project: { id: projectId, gitRepoPath: project.gitRepoPath },
    epic: { id: epicId, branchName: epic.branchName, status: fromStatus },
    worktreePath: conflictWorktreePath,
    error,
    namedAgentId: options.namedAgentId ?? null,
  });

  if (!sessionId) {
    return { status: "failed", error, sessionId: null };
  }

  logTransition({
    projectId,
    epicId,
    fromStatus,
    toStatus: fromStatus,
    actor: "system",
    reason: AUTO_MODE_REASONS.mergeConflict,
    sessionId,
  });
  autoModeRegistry.recordDispatch(projectId, {
    kind: "merge-fix",
    epicId,
    userStoryId: null,
    sessionId,
    detail: error,
  });

  return { status: "conflict", error, sessionId };
}

/**
 * Dispatches the conflict-resolution agent and wires the single retry.
 *
 * Returns the session id (so the caller can charge it to the build budget),
 * or null when the dispatch itself failed. The retry runs inside the launch
 * closure — the same "the closure owns the whole session lifetime" contract
 * the scheduler expects everywhere else.
 */
async function dispatchMergeFixAgent(input: {
  project: { id: string; gitRepoPath: string };
  epic: { id: string; branchName: string; status: KanbanStatus };
  worktreePath: string;
  error: string;
  namedAgentId: string | null;
}): Promise<string | null> {
  const { project, epic, worktreePath, error } = input;

  try {
    const resolved = resolveAgentByNamedId(
      "merge",
      project.id,
      input.namedAgentId
    );

    const mergeSystemPrompt = await resolveAgentPrompt("merge", project.id);
    const prompt = [
      mergeSystemPrompt,
      `The branch "${epic.branchName}" failed to merge into main.`,
      `Error: ${error}`,
      "",
      "Resolve the merge conflicts and complete the merge. Steps:",
      `1. In the worktree at ${worktreePath}, run: git merge main`,
      "2. Resolve all conflicts in the affected files",
      "3. Stage and commit the resolution",
      "4. Verify the build still passes",
    ]
      .filter(Boolean)
      .join("\n");

    const sessionId = createId();
    const now = new Date().toISOString();
    const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
    fs.mkdirSync(logsDir, { recursive: true });
    const logsPath = path.join(logsDir, "logs.json");

    const cliSessionId =
      isResumableProvider(resolved.provider) &&
      !providerReportsOwnSessionId(resolved.provider)
        ? crypto.randomUUID()
        : undefined;

    createQueuedSession({
      id: sessionId,
      projectId: project.id,
      epicId: epic.id,
      mode: "code",
      orchestrationMode: "solo",
      provider: resolved.provider,
      prompt,
      logsPath,
      branchName: epic.branchName,
      worktreePath,
      cliSessionId,
      namedAgentId: resolved.namedAgentId ?? null,
      agentType: "merge",
      namedAgentName: resolved.name || null,
      model: resolved.model || null,
      batchRunId: autoRunId(project.id),
      createdAt: now,
    });

    agentScheduler.submit(project.id, sessionId, async () => {
      markSessionRunning(sessionId);
      processManager.start(
        sessionId,
        {
          mode: "code",
          prompt,
          cwd: worktreePath,
          allowedTools: MERGE_ALLOWED_TOOLS,
          model: resolved.model,
          cliSessionId,
        },
        resolved.provider
      );

      const info = await waitForProcessCompletion(sessionId);
      const completedAt = new Date().toISOString();
      const agentResult = info?.result;

      try {
        fs.writeFileSync(logsPath, JSON.stringify(agentResult, null, 2));
      } catch {
        // ignore
      }

      try {
        markSessionTerminal(
          sessionId,
          {
            success: !!agentResult?.success,
            error: agentResult?.error || null,
            outcome: classifySessionOutcome(agentResult, sessionId),
            usage: extractSessionUsage(agentResult),
          },
          completedAt
        );
      } catch (finalizeError) {
        if (!isSessionLifecycleConflictError(finalizeError)) {
          console.error(
            "[auto-mode/merge] Failed to finalize merge-fix session",
            finalizeError
          );
        }
      }

      db.insert(ticketComments)
        .values({
          id: createId(),
          epicId: epic.id,
          author: "agent",
          content: resolveSessionOutput(agentResult, sessionId),
          agentSessionId: sessionId,
          createdAt: completedAt,
        })
        .run();

      await retryMergeAfterFix({
        projectId: project.id,
        gitRepoPath: project.gitRepoPath,
        epicId: epic.id,
        branchName: epic.branchName,
        worktreePath,
        sessionId,
        agentSucceeded: !!agentResult?.success,
        originalError: error,
      });
    });

    return sessionId;
  } catch (dispatchError) {
    console.warn(
      "[auto-mode/merge] Merge-fix dispatch failed:",
      dispatchError instanceof Error ? dispatchError.message : dispatchError
    );
    return null;
  }
}

/**
 * The single retry. A second failure parks the epic and notifies — the
 * standing loop must never grind on a conflict no agent could resolve.
 */
async function retryMergeAfterFix(input: {
  projectId: string;
  gitRepoPath: string;
  epicId: string;
  branchName: string;
  worktreePath: string;
  sessionId: string;
  agentSucceeded: boolean;
  originalError: string;
}): Promise<void> {
  const park = (error: string): void => {
    // Drop the merge-fix session from the in-flight map FIRST. It completed
    // successfully as an agent run, so leaving it there would let the next
    // sweep's reconcile read "completed" and clear the very failure streak we
    // are about to set — un-parking the epic and looping on the conflict.
    // (`park` also marks the entry hard, so ordering is belt and braces.)
    autoModeRegistry.removeInFlight(input.projectId, input.sessionId);
    autoModeRegistry.park(
      input.projectId,
      input.epicId,
      input.epicId,
      `merge conflict unresolved: ${error}`
    );
    const held =
      db
        .select({ status: epics.status })
        .from(epics)
        .where(eq(epics.id, input.epicId))
        .get()?.status ?? "review";
    logTransition({
      projectId: input.projectId,
      epicId: input.epicId,
      fromStatus: held,
      toStatus: held,
      actor: "system",
      reason: AUTO_MODE_REASONS.parked(3),
      sessionId: input.sessionId,
    });
    try {
      createAutoModeMergeParkedNotification({
        projectId: input.projectId,
        epicId: input.epicId,
        sessionId: input.sessionId,
        error,
      });
    } catch (notifyError) {
      console.warn(
        "[auto-mode/merge] Failed to create parked notification:",
        (notifyError as Error).message
      );
    }
  };

  if (!input.agentSucceeded) {
    park(input.originalError);
    return;
  }

  let retry: Awaited<ReturnType<typeof mergeWorktree>>;
  try {
    retry = await mergeWorktree(
      input.gitRepoPath,
      input.branchName,
      input.worktreePath
    );
  } catch (mergeError) {
    park(mergeError instanceof Error ? mergeError.message : "Merge failed");
    return;
  }

  if (!retry.merged) {
    park(retry.error || "Merge failed");
    return;
  }

  const finalized = finalizeMergedEpic({
    projectId: input.projectId,
    epicId: input.epicId,
    sessionId: input.sessionId,
    reason: AUTO_MODE_REASONS.mergeFixRetried,
  });

  if (!finalized.ok) {
    // Merged on disk but the board refuses to move — a human decision is
    // needed either way, so park rather than retry.
    park(finalized.error);
    return;
  }

  autoModeRegistry.clearFailures(input.projectId, input.epicId);
  autoModeRegistry.recordDispatch(input.projectId, {
    kind: "merge",
    epicId: input.epicId,
    userStoryId: null,
    sessionId: input.sessionId,
    detail: retry.commitHash ?? null,
  });
}
