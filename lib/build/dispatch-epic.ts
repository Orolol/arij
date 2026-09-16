import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import { mintAssignedCliSessionId } from "@/lib/agent-sessions/dispatch-background-session";
import { dispatchBuildSession } from "@/lib/agent-sessions/dispatch-ticket-session";
import { isResumableProvider } from "@/lib/agent-sessions/resume-capability";
import { createSessionLogsPath } from "@/lib/agent-sessions/session-paths";
import { validateResumeSession } from "@/lib/agent-sessions/validate-resume";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import {
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import {
  resolveSessionOutput
} from "@/lib/claude/resolve-session-output";
import { db } from "@/lib/db";
import {
  agentSessions,
  epics,
  ticketComments,
} from "@/lib/db/schema";
import {
  attachWorktree,
  createWorktree,
  isGitRepo,
  resolveWorktreeHead,
} from "@/lib/git/manager";
import {
  resolvePipelineEnabled,
  startPipelineRun
} from "@/lib/pipeline";
import {
  ciAutofixAttemptId,
  parseCiAutofixPayload,
} from "@/lib/routines/ci-autofix-shared";
import { assembleEpicBuildPrompt } from "@/lib/tokens";
import { isBuildableStatus } from "@/lib/types/kanban";
import { createId } from "@/lib/utils/nanoid";
import {
  finalizeBuildTerminalOutcome,
  resolveBuildSessionResult,
  transitionBuildStarted,
  WorkflowTransitionError
} from "@/lib/workflow/automatic-transitions";
import { postTicketSystemComment, postUnresolvedMentionsComment } from "@/lib/workflow/system-comment";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";


export async function dispatchEpicBuild(projectId: string, epicId: string, body: { ciAutofix?: unknown; namedAgentId?: string | null; pipeline?: boolean; comment?: string; resumeSessionId?: string }) {
  const ciAutofix =
    body.ciAutofix === undefined ? null : parseCiAutofixPayload(body.ciAutofix);
  if (body.ciAutofix !== undefined && !ciAutofix) {
    return NextResponse.json(
      { error: "Invalid ciAutofix payload" },
      { status: 400 },
    );
  }
  const namedAgentId: string | null = body.namedAgentId || null;
  // Autonomous pipeline flag: an explicit boolean forces on/off; absent, the
  // pipeline_enabled setting chain decides (default ON).
  const pipelineParam: boolean | undefined =
    typeof body.pipeline === "boolean" ? body.pipeline : undefined;

  // Validate epic exists (project-scoped)
  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;

  const ciAutofixRunId = ciAutofix
    ? ciAutofixAttemptId({
        epicId,
        prNumber: ciAutofix.prNumber,
        headSha: ciAutofix.headSha,
      })
    : null;
  const findExistingCiAutofixAttempt = () =>
    ciAutofixRunId
      ? db
          .select({ id: agentSessions.id })
          .from(agentSessions)
          .where(
            and(
              eq(agentSessions.projectId, projectId),
              eq(agentSessions.epicId, epicId),
              eq(agentSessions.batchRunId, ciAutofixRunId),
            ),
          )
          .get()
      : null;
  const existingAttempt = findExistingCiAutofixAttempt();
  if (existingAttempt) {
    return NextResponse.json({
      data: {
        sessionId: existingAttempt.id,
        ciAutofix: { launched: false, reason: "already_attempted" },
      },
    });
  }

  // Validate status — same source of truth as the batch build's guard.
  if (!isBuildableStatus(epic.status)) {
    return NextResponse.json(
      {
        error:
          "Epic must be in backlog, todo, in_progress, or review status to build",
      },
      { status: 400 },
    );
  }

  let ciAutofixBranchName: string | null = null;
  if (ciAutofix) {
    if (!epic.branchName) {
      return NextResponse.json(
        {
          error: "CI autofix requires the epic's persisted pull request branch",
        },
        { status: 400 },
      );
    }
    ciAutofixBranchName = epic.branchName;
  }

  // Get project
  const foundProject = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(foundProject)) return foundProject;
  const { project } = foundProject;

  const gitRepoPath = project.gitRepoPath;
  const isRepo = await isGitRepo(gitRepoPath);
  if (!isRepo) {
    return NextResponse.json(
      { error: `Path is not a git repository: ${gitRepoPath}` },
      { status: 400 },
    );
  }

  // Post optional comment as epic comment
  if (body.comment && body.comment.trim()) {
    db.insert(ticketComments)
      .values({
        id: createId(),
        epicId,
        author: "user",
        content: body.comment.trim(),
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  // Prepare worktree

  // A CI autofix must modify the exact branch behind the PR. Deriving a
  // branch from the current epic title could silently cut a new branch from
  // the base branch after the title has been edited.
  const { worktreePath, branchName } = ciAutofixBranchName
    ? await attachWorktree(gitRepoPath, ciAutofixBranchName)
    : await createWorktree(gitRepoPath, epic.id, epic.title, {
        defaultBranch: project.defaultBranch,
      });

  const worktreeHead = ciAutofix && ciAutofixBranchName
    ? await resolveWorktreeHead(worktreePath)
    : null;

  const assembled = await assembleEpicBuildPrompt({
    projectId,
    epicId,
    project,
    epic,
    comment: body.comment,
    commentAlreadyPersisted: true,
    ciAutofix,
    worktreeHead,
  });
  const enrichedPrompt = assembled.prompt;
  postUnresolvedMentionsComment({
    epicId,
    missing: assembled.missingDocuments,
    agentType: "build",
  });

  const resolvedAgent = resolveAgentByNamedId("build", projectId, namedAgentId);

  // Resume support — scope-guarded
  let cliSessionId: string | undefined;
  let resumeSession = false;
  if (
    !ciAutofix &&
    isResumableProvider(resolvedAgent.provider) &&
    body.resumeSessionId
  ) {
    const validated = validateResumeSession({
      resumeSessionId: body.resumeSessionId,
      epicId: epicId,
      expectedProvider: resolvedAgent.provider,
    });
    if (validated) {
      cliSessionId = validated.cliSessionId;
      resumeSession = true;
    }
  }
  if (!cliSessionId) {
    cliSessionId = mintAssignedCliSessionId(resolvedAgent.provider);
  }

  // Create session
  const sessionId = createId();
  const now = new Date().toISOString();
  const logsPath = createSessionLogsPath(sessionId);

  // The first lookup happened before repository/worktree preparation. Repeat
  // it immediately before the no-await conflict/transition/insert section so
  // two CI-watch routines that prepared concurrently cannot both persist a
  // session for the same PR head.
  const concurrentAttempt = findExistingCiAutofixAttempt();
  if (concurrentAttempt) {
    return NextResponse.json({
      data: {
        sessionId: concurrentAttempt.id,
        ciAutofix: { launched: false, reason: "already_attempted" },
      },
    });
  }

  // Check concurrency guard
  const conflict = getRunningSessionForTarget({
    scope: "epic",
    projectId,
    epicId,
  });
  if (conflict) {
    return NextResponse.json(
      createAgentAlreadyRunningPayload(
        { scope: "epic", projectId, epicId },
        conflict,
        "Another agent is already running for this epic.",
      ),
      { status: 409 },
    );
  }

  try {
    transitionBuildStarted({
      projectId,
      epicId,
      scope: "epic",
      sessionId,
      reason: ciAutofix
        ? `CI autofix started for PR #${ciAutofix.prNumber} at ${ciAutofix.headSha.slice(0, 12)}`
        : undefined,
    });
  } catch (error) {
    if (error instanceof WorkflowTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // Branch metadata is not a status transition and stays a plain update.
  // Autofix deliberately preserves the PR branch recorded on the epic.
  if (!ciAutofix) {
    db.update(epics)
      .set({ branchName, updatedAt: now })
      .where(eq(epics.id, epicId))
      .run();
  }

  const row = {
    id: sessionId,
    projectId,
    epicId,
    mode: "code" as const,
    provider: resolvedAgent.provider,
    prompt: enrichedPrompt,
    estimatedPromptTokens: assembled.tokens.total,
    estimatedPromptBreakdown: JSON.stringify(assembled.tokens.breakdown),
    logsPath,
    branchName,
    worktreePath,
    cliSessionId,
    namedAgentId: resolvedAgent.namedAgentId ?? null,
    compositeAgentId: resolvedAgent.compositeAgentId ?? null,
    agentType: "build",
    namedAgentName: resolvedAgent.name || null,
    model: resolvedAgent.model || null,
    batchRunId: ciAutofixRunId,
    createdAt: now,
  };


  // Batch-style launch: goes through the per-project scheduler. The session
  // stays 'queued' until a slot frees; the closure spawns, waits for
  // completion, syncs statuses, and posts the agent comment. It returns the
  // {success, outcome, error} triple so the pipeline's settle wrapper can
  // observe the terminal result.
  const dispatched = dispatchBuildSession({ row, resolvedAgent, resumeSession,
    onTerminal: async ({ result, outcome, completedAt }) => {
    const terminal = finalizeBuildTerminalOutcome({
      projectId,
      epicId,
      scope: "epic",
      sessionId,
      success: !!result?.success,
      outcome,
      error: result?.error,
      reason: ciAutofix
        ? `CI autofix completed locally for PR #${ciAutofix.prNumber}; ` +
          `branch ${branchName} carries an unpushed fix for head ${ciAutofix.headSha.slice(0, 12)} and requires a manual push`
        : undefined,
    });
    if (ciAutofix && terminal.kind === "promoted") {
      // A successful autofix only changes the LOCAL branch, so the required
      // manual push has to be visible on the ticket — the inbox is the one
      // signalling surface left.
      try {
        postTicketSystemComment({
          epicId,
          sessionId,
          content:
            `CI autofix completed locally — push ${branchName} for PR #${ciAutofix.prNumber}.\n\n` +
            `The branch contains a fix for head ${ciAutofix.headSha.slice(0, 12)}, but Arij did not push it automatically. Push the branch to rerun CI.`,
        });
      } catch (error) {
        console.warn(
          `[epic build] Failed to post that CI autofix ${sessionId} is ready to push`,
          error,
        );
      }
    }

    // Post output as epic comment
    const output = resolveSessionOutput(result, sessionId);

    db.insert(ticketComments)
      .values({
        id: createId(),
        epicId,
        author: "agent",
        content: output,
        agentSessionId: sessionId,
        createdAt: completedAt,
      })
      .run();

    return resolveBuildSessionResult(terminal, {
      success: !!result?.success,
      outcome,
      error: result?.error ?? null,
    });
  }});

  // Autonomous pipeline: when active, wrap the launch closure with the
  // settle pattern (copied from the batch route's launchEpic) so the run's
  // engine can await this build's terminal state, then start the run.
  const pipelineActive = ciAutofix
    ? false
    : (pipelineParam ?? resolvePipelineEnabled(projectId));

  let pipeline: { runId: string } | null = null;
  if (pipelineActive) {
    pipeline = startPipelineRun({
      projectId,
      scope: "epic",
      epicId,
      userStoryId: null,
      buildSessionId: sessionId,
      buildProvider: resolvedAgent.provider,
      buildNamedAgentId: namedAgentId,
      buildSettled: dispatched.settled,
    });
  }

  return NextResponse.json({
    data: {
      sessionId,
      branchName,
      worktreePath,
      pipeline,
      ...(ciAutofix ? { ciAutofix: { launched: true } } : {}),
    },
  });
}
