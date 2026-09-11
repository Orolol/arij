/**
 * Learned project memory — distillation workflow.
 *
 * A 'memory_distill' agent session reads the current memory document plus the
 * just-finished session's context and rewrites the memory (merge durable
 * conventions, drop per-ticket trivia, stay under the hard cap). Its result
 * replaces the memory document.
 *
 * Two triggers share `dispatchMemoryDistillSession`:
 *   - manual: POST /api/projects/[projectId]/memory/distill (button on a
 *     completed session's detail page);
 *   - auto: `maybeAutoDistillAfterSessionTerminal`, invoked from the
 *     boot-registered session terminal hook (instrumentation.ts →
 *     lib/agent-sessions/terminal-hooks.ts) when the 'memory_auto_distill'
 *     setting is on. Guards: build-type source sessions only, never a
 *     distill-of-a-distill, never on failures, and no duplicate while a
 *     distill is already pending for the project.
 *
 * Dispatch goes through the per-project agent scheduler with the normal
 * session lifecycle (queued → running → terminal), like every other
 * batch-style agent.
 *
 * Batch attribution: when the source session carries a `batch_run_id` (a DAG
 * batch or a night run), the distill session inherits it. Otherwise a night
 * run's auto-distills would spend real money outside its cost cap and go
 * missing from the morning summary — both of which read `batch_run_id` and
 * nothing else, so the tag alone wires them up.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, epics, projects, userStories } from "@/lib/db/schema";
import {
  dispatchBackgroundSession,
  type BackgroundSessionRun,
  type BackgroundSessionVerdict,
} from "@/lib/agent-sessions/dispatch-background-session";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import { buildMemoryDistillPrompt } from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  getProjectMemoryContent,
  isProjectMemoryChangedError,
  sanitizeMemoryDocument,
  saveProjectMemoryGuarded,
} from "@/lib/documents/memory";
import {
  MEMORY_AUTO_DISTILL_SETTING_KEY,
  parseMemoryAutoDistillSetting,
} from "@/lib/documents/memory-constants";
import { isNightRunId } from "@/lib/night/constants";
import { createMemoryDistilledNotification } from "@/lib/notifications/create";
import { recordMemoryWriteProvenance } from "@/lib/documents/memory-provenance";
import { emitMemoryDiscarded, emitSessionStarted } from "@/lib/events/emit";
import { eventBus } from "@/lib/events/bus";
import {
  MEMORY_WRITER_AGENT_TYPES,
  type MemoryDiscardReason,
} from "./dreaming-constants";
// The settings module, not the dreaming facade: the stand-down only needs the
// switch's answer, not the dream's dispatch path.
import {
  isDreamingAfterNightRunEnabled,
  readSettingValue,
} from "./dreaming-settings";
import { resolveFinalText } from "./session-final-text";
import {
  MEMORY_WRITER_BUSY_MESSAGE,
  hasPendingMemoryWriter,
} from "./memory-writer-lock";
import { logTransition } from "./log";

const POLL_INTERVAL_MS = 2000;

/** Cap on the source-session result summary embedded in the distill prompt. */
export const MEMORY_DISTILL_SUMMARY_MAX_CHARS = 2000;

/** Activity-log reason written when a distill run replaces the memory doc. */
export const MEMORY_UPDATED_REASON = "Project memory updated";

/**
 * Source agent types eligible for auto-distillation: the build flavors.
 * Reviews, QA, merges and (critically) the memory writers themselves
 * ('memory_distill', 'dreaming') never auto-trigger.
 */
export const AUTO_DISTILL_SOURCE_AGENT_TYPES: readonly string[] = [
  "build",
  "ticket_build",
  "team_build",
];

/** Reads the 'memory_auto_distill' setting (DEFAULT OFF when absent). */
export function isMemoryAutoDistillEnabled(): boolean {
  return parseMemoryAutoDistillSetting(
    readSettingValue(MEMORY_AUTO_DISTILL_SETTING_KEY)
  );
}

// ---------------------------------------------------------------------------
// Auto-trigger guards
// ---------------------------------------------------------------------------

export interface AutoDistillCandidateSession {
  id: string;
  projectId: string | null;
  agentType: string | null;
  status: string | null;
  outcome: string | null;
  /** Batch/night run that dispatched this session; null for standalone runs. */
  batchRunId: string | null;
}

export interface AutoDistillDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Pure guard matrix for the auto-trigger — exported for exhaustive testing.
 *
 * Denials, in evaluation order:
 *   - setting off (default),
 *   - unknown session,
 *   - non-completed status (failures/cancellations never distill),
 *   - a memory WRITER source ('memory_distill' or 'dreaming' — never distill
 *     a distill, never distill a dream),
 *   - non-build agent types,
 *   - asked_question outcome (the build is still awaiting the user — its
 *     learnings are not settled yet),
 *   - a night-run dream will cover this session anyway (see
 *     nightRunDreamWillFollow): the two writers share one lock and the dream
 *     gets exactly one attempt, so a distill running at that moment would
 *     cancel it outright,
 *   - a memory writer (distill OR dream) already queued/running for the
 *     project — both rewrite the whole document, so they must not overlap.
 */
export function evaluateAutoDistillGuards(input: {
  enabled: boolean;
  session: AutoDistillCandidateSession | null;
  hasPendingDistill: boolean;
  /** True when a night-run dream will cover this session — see below. */
  dreamWillFollow?: boolean;
}): AutoDistillDecision {
  if (!input.enabled) {
    return { allowed: false, reason: "auto-distill setting is off" };
  }
  if (!input.session) {
    return { allowed: false, reason: "session not found" };
  }
  if (input.session.status !== "completed") {
    return {
      allowed: false,
      reason: `session status is '${input.session.status ?? "unknown"}', not 'completed'`,
    };
  }
  if (
    input.session.agentType &&
    MEMORY_WRITER_AGENT_TYPES.includes(input.session.agentType)
  ) {
    return { allowed: false, reason: "never distill a distill session" };
  }
  if (
    !input.session.agentType ||
    !AUTO_DISTILL_SOURCE_AGENT_TYPES.includes(input.session.agentType)
  ) {
    return {
      allowed: false,
      reason: `agent type '${input.session.agentType ?? "unknown"}' is not a build type`,
    };
  }
  if (input.session.outcome === "asked_question") {
    return { allowed: false, reason: "session ended by asking a question" };
  }
  if (!input.session.projectId) {
    return { allowed: false, reason: "session has no project" };
  }
  if (input.dreamWillFollow) {
    return {
      allowed: false,
      reason: "a night-run dream will distill this session's run instead",
    };
  }
  if (input.hasPendingDistill) {
    return {
      allowed: false,
      reason:
        "a memory rewrite (distill or dream) is already pending for this project",
    };
  }
  return { allowed: true, reason: "eligible" };
}

// ---------------------------------------------------------------------------
// Source eligibility (shared by the manual route and the dispatch boundary)
// ---------------------------------------------------------------------------

/** Thrown when a caller names a session that may not be a distill source. */
export class MemoryDistillSourceError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "MemoryDistillSourceError";
  }
}

export function isMemoryDistillSourceError(error: unknown): boolean {
  return error instanceof MemoryDistillSourceError;
}

export interface DistillSourceCandidate {
  agentType: string | null;
  status: string | null;
  /** Delivery verdict — 'asked_question' is completed but NOT settled. */
  outcome: string | null;
}

export interface DistillSourceEligibility {
  eligible: boolean;
  /** Empty when eligible; otherwise the message the caller reports. */
  reason: string;
}

/**
 * Whether a session may be handed to a distill as its context source.
 *
 * The auto-trigger has always enforced this (evaluateAutoDistillGuards) and
 * the UI only offers the button where it holds, but the manual endpoint took
 * any session id belonging to the project. Three rules, deliberately looser
 * than the auto matrix because the manual button IS offered on reviews and QA
 * runs:
 *
 *   - never a memory WRITER. Its output is the memory document itself, so
 *     distilling it would feed the memory back into the memory;
 *   - only a COMPLETED run. A queued or running session has no learnings yet,
 *     and a failed one has no delivered output to read;
 *   - never an ASKED_QUESTION run. Those are `completed` too, so the status
 *     check alone lets them through — but the agent stopped to ask the user
 *     something and the answer never came. Distilling one writes an unresolved
 *     question into a document injected in every future prompt, as if it were
 *     a settled convention. The auto matrix has always refused it; the manual
 *     path now agrees.
 *
 * `null` means the session does not exist (or belongs to another project) —
 * the caller's own 404 case.
 */
export function evaluateDistillSourceEligibility(
  session: DistillSourceCandidate | null
): DistillSourceEligibility {
  if (!session) {
    return { eligible: false, reason: "Source session not found" };
  }
  if (
    session.agentType &&
    MEMORY_WRITER_AGENT_TYPES.includes(session.agentType)
  ) {
    return {
      eligible: false,
      reason:
        "A memory distill or dream session cannot itself be distilled — its output IS the project memory.",
    };
  }
  if (session.status !== "completed") {
    return {
      eligible: false,
      reason: `Only a completed session can be distilled (this one is '${session.status ?? "unknown"}').`,
    };
  }
  if (session.outcome === "asked_question") {
    return {
      eligible: false,
      reason:
        "This session stopped to ask a question — its learnings are not settled yet, so there is nothing durable to distill.",
    };
  }
  return { eligible: true, reason: "" };
}

/**
 * True when this session's completion should stand down for the cross-session
 * dream the night run will fire when it ends.
 *
 * Both writers take the same exclusive lock on the memory document, and the
 * dream is attempted EXACTLY ONCE at the run's terminal choke point. So an
 * auto-distill still holding the lock at that instant does not merely delay
 * the dream — it cancels it, permanently, for that run. Standing the distill
 * down is the right way round: the dream reads the whole run (this session
 * included) rather than one session of it, the user asked for it explicitly by
 * enabling the setting, and it costs one session instead of one per build.
 */
export function nightRunDreamWillFollow(
  session: AutoDistillCandidateSession | null
): boolean {
  if (!session?.projectId || !isNightRunId(session.batchRunId)) return false;
  return isDreamingAfterNightRunEnabled();
}

/**
 * True when ANY memory writer is queued/running for the project — a distill OR
 * a dream.
 *
 * Deliberately wider than its name suggests, and kept under that name because
 * it is the distill flow's guard: the two writers replace the SAME whole
 * document, so a distill must stand down for a running dream exactly as it
 * stands down for another distill. See lib/workflow/memory-writer-lock.ts.
 */
export function hasPendingMemoryDistill(projectId: string): boolean {
  return hasPendingMemoryWriter(projectId);
}

/**
 * Auto-trigger entry point, invoked (fire-and-forget) from the session
 * terminal hook for completed sessions. Best-effort by design: it must never
 * throw into the lifecycle transition, and every denial is silent except for
 * unexpected errors.
 */
export async function maybeAutoDistillAfterSessionTerminal(
  sessionId: string
): Promise<AutoDistillDecision> {
  try {
    // Cheapest check first — the feature is off by default.
    const enabled = isMemoryAutoDistillEnabled();
    if (!enabled) {
      return { allowed: false, reason: "auto-distill setting is off" };
    }

    const session =
      db
        .select({
          id: agentSessions.id,
          projectId: agentSessions.projectId,
          agentType: agentSessions.agentType,
          status: agentSessions.status,
          outcome: agentSessions.outcome,
          batchRunId: agentSessions.batchRunId,
        })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .get() ?? null;

    const decision = evaluateAutoDistillGuards({
      enabled,
      session,
      hasPendingDistill: session?.projectId
        ? hasPendingMemoryDistill(session.projectId)
        : false,
      dreamWillFollow: nightRunDreamWillFollow(session),
    });

    if (!decision.allowed) {
      return decision;
    }

    await dispatchMemoryDistillSession({
      projectId: session!.projectId!,
      sourceSessionId: sessionId,
    });
    return decision;
  } catch (err) {
    console.warn(
      "[memory-distill] Auto-distill trigger failed:",
      (err as Error).message
    );
    return { allowed: false, reason: "auto-distill trigger failed" };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface DispatchMemoryDistillInput {
  projectId: string;
  /** Session whose learnings should be distilled (context source). */
  sourceSessionId?: string | null;
}

export interface DispatchMemoryDistillResult {
  sessionId: string;
}

interface SourceSessionContext {
  epicId: string | null;
  ticketTitle: string | null;
  agentType: string | null;
  outcome: string | null;
  resultSummary: string | null;
  /**
   * Batch/night run that owns the source session. Inherited by the distill
   * session so its cost is counted by the night run's cost cap and by the
   * morning summary — both query purely on `agent_sessions.batch_run_id`, so
   * tagging the row is the ENTIRE integration.
   */
  batchRunId: string | null;
}

/**
 * The two columns `evaluateDistillSourceEligibility` judges, project-scoped so
 * a session id from another project reads as "not found".
 */
export function loadDistillSourceCandidate(
  projectId: string,
  sourceSessionId: string
): DistillSourceCandidate | null {
  return (
    db
      .select({
        agentType: agentSessions.agentType,
        status: agentSessions.status,
        outcome: agentSessions.outcome,
      })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.id, sourceSessionId),
          eq(agentSessions.projectId, projectId)
        )
      )
      .get() ?? null
  );
}

function loadSourceSessionContext(
  projectId: string,
  sourceSessionId: string
): SourceSessionContext | null {
  const session = db
    .select({
      id: agentSessions.id,
      projectId: agentSessions.projectId,
      epicId: agentSessions.epicId,
      userStoryId: agentSessions.userStoryId,
      agentType: agentSessions.agentType,
      status: agentSessions.status,
      outcome: agentSessions.outcome,
      lastNonEmptyText: agentSessions.lastNonEmptyText,
      logsPath: agentSessions.logsPath,
      batchRunId: agentSessions.batchRunId,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.id, sourceSessionId),
        eq(agentSessions.projectId, projectId)
      )
    )
    .get();

  if (!session) return null;

  let ticketTitle: string | null = null;
  if (session.userStoryId) {
    ticketTitle =
      db
        .select({ title: userStories.title })
        .from(userStories)
        .where(eq(userStories.id, session.userStoryId))
        .get()?.title ?? null;
  }
  if (!ticketTitle && session.epicId) {
    ticketTitle =
      db
        .select({ title: epics.title })
        .from(epics)
        .where(eq(epics.id, session.epicId))
        .get()?.title ?? null;
  }

  // The session's final response, resolved exactly as the dream collector
  // resolves it: the persisted response/output stream first, the one-line
  // `last_non_empty_text` column only as a last resort. Reading that column
  // first handed the distill ONE line of a whole report. A tail, not a head,
  // because a report's conclusion is its end.
  const resultSummary = resolveFinalText(
    {
      id: session.id,
      logsPath: session.logsPath,
      lastNonEmptyText: session.lastNonEmptyText,
    },
    MEMORY_DISTILL_SUMMARY_MAX_CHARS
  );

  return {
    epicId: session.epicId ?? null,
    ticketTitle,
    agentType: session.agentType ?? null,
    outcome: session.outcome ?? null,
    resultSummary,
    batchRunId: session.batchRunId ?? null,
  };
}

/**
 * The English sentence a distill's session row carries in its `error` column
 * when its output was not stored (the session page shows it). The memory
 * panel gets the reason CODE on `memory:discarded` and uses its own copy.
 */
const DISTILL_DISCARD_ERRORS: Record<
  // A distill imposes no section structure, so it has no structure refusal.
  Exclude<MemoryDiscardReason, "invalid_structure">,
  string
> = {
  no_output:
    "The distill finished without returning a memory document — the memory was left unchanged.",
  memory_changed:
    "The memory was edited while the distill ran — the edit was kept and the distill's output discarded.",
  save_failed:
    "The distilled memory could not be saved — the memory was left unchanged.",
};

/**
 * Creates a queued 'memory_distill' session and submits its launch closure to
 * the per-project scheduler. On success (outcome 'answered'), the session's
 * output replaces the project memory document (cap-enforced) and — when the
 * source session was ticket-scoped — an actor-'system' activity-log entry
 * records the update.
 *
 * Throws when the project does not exist; every failure after dispatch
 * surfaces on the session row instead.
 */
export async function dispatchMemoryDistillSession(
  input: DispatchMemoryDistillInput
): Promise<DispatchMemoryDistillResult> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) {
    throw new Error("Project not found");
  }

  // Enforced HERE, not only in the route: this is the boundary every caller
  // goes through, so an ineligible source cannot reach a session row by
  // arriving from somewhere the route's checks do not cover.
  if (input.sourceSessionId) {
    const eligibility = evaluateDistillSourceEligibility(
      loadDistillSourceCandidate(input.projectId, input.sourceSessionId)
    );
    if (!eligibility.eligible) {
      throw new MemoryDistillSourceError(eligibility.reason);
    }
  }

  const sourceContext = input.sourceSessionId
    ? loadSourceSessionContext(input.projectId, input.sourceSessionId)
    : null;

  const currentMemory = getProjectMemoryContent(input.projectId);
  const systemPrompt = await resolveAgentPrompt("memory_distill", input.projectId);
  // No per-call override: the distill agent is chosen in Agent Config, the
  // one surface every background writer reads its agent from.
  const resolvedAgent = resolveAgentByNamedId(
    "memory_distill",
    input.projectId,
    null
  );

  const prompt = buildMemoryDistillPrompt(
    // Defensive `memory: null`: this builder frames the current memory itself
    // and does not inject the standard section today — the null keeps a future
    // `withProjectMemory` wrapping from quietly adding the document twice.
    { ...project, memory: null },
    currentMemory,
    {
      ticketTitle: sourceContext?.ticketTitle ?? null,
      agentType: sourceContext?.agentType ?? null,
      outcome: sourceContext?.outcome ?? null,
      resultSummary: sourceContext?.resultSummary ?? null,
    },
    systemPrompt
  );

  // Last-resort race guard, under NO await: the callers' pending checks ran
  // before `resolveAgentPrompt` above, so a dream (or another distill) could
  // have taken the document during that suspension. Everything from here to
  // the insert is synchronous, which on Node's single thread is what makes the
  // shared memory-writer lock hold instead of merely usually holding.
  if (hasPendingMemoryWriter(input.projectId)) {
    throw new Error(MEMORY_WRITER_BUSY_MESSAGE);
  }

  // Set by `evaluate` when a delivered distill was NOT stored; read by
  // `onTerminal`, which always runs after it.
  let discard: MemoryDiscardReason | null = null;
  let stored = false;

  /**
   * The memory write, done BEFORE the session row is finalised so the row
   * tells the truth: a distill whose output was dropped (a human edit landed
   * mid-run, or the save threw) must not read as a successful run over an
   * unchanged memory. Synchronous, so the whole decision fits in the hook.
   */
  const evaluate = ({
    sessionId: sid,
    result,
    outcome,
  }: BackgroundSessionRun): BackgroundSessionVerdict => {
    // Silent runs, asked questions and failures leave the memory doc
    // untouched and keep the provider's own verdict.
    if (!result?.success || outcome !== "answered") {
      return { success: !!result?.success, error: result?.error ?? null };
    }

    const output = sanitizeMemoryDocument(resolveSessionOutput(result, sid, ""));
    if (!output) {
      discard = "no_output";
      return { success: false, error: DISTILL_DISCARD_ERRORS.no_output };
    }

    try {
      // `expectedPrevious` is the memory this distill actually REASONED FROM,
      // captured at prompt time above. A plan session runs long enough for
      // someone to save an edit in the Docs tab meanwhile; writing blindly
      // would throw that edit away in favour of text derived from the version
      // before it. The human edit is the newer intent and wins — a distill can
      // just be run again. (No snapshot: the single archive row is the undo
      // for the last DREAM, and a distill must not spend it.)
      saveProjectMemoryGuarded(input.projectId, output, {
        expectedPrevious: currentMemory,
      });
    } catch (error) {
      if (isProjectMemoryChangedError(error)) {
        discard = "memory_changed";
        return { success: false, error: DISTILL_DISCARD_ERRORS.memory_changed };
      }
      console.error("[memory-distill] Failed to save distilled memory", error);
      discard = "save_failed";
      return { success: false, error: DISTILL_DISCARD_ERRORS.save_failed };
    }

    stored = true;
    return { success: true, error: null };
  };

  // Deliberately no epicId on the distill session row: epic-scoped
  // concurrency guards must not treat a background distill as "an agent is
  // already running for this epic". The activity log below still anchors to
  // the source ticket.
  //
  // batchRunId IS inherited though: a distill auto-triggered by a night-run
  // build is work that run caused, so its cost must land inside the run's
  // cost cap and morning summary instead of escaping both. (No epicId means
  // the summary counts it in the run total, not against a single epic.)
  const { sessionId } = dispatchBackgroundSession({
    agentType: "memory_distill",
    projectId: input.projectId,
    prompt,
    resolvedAgent,
    mode: "plan",
    cwd: project.gitRepoPath || process.cwd(),
    pollIntervalMs: POLL_INTERVAL_MS,
    logPrefix: "[memory-distill]",
    session: { batchRunId: sourceContext?.batchRunId ?? null },
    onQueued: ({ sessionId: sid }) => {
      try {
        emitSessionStarted(
          input.projectId,
          sourceContext?.epicId ?? "",
          sid,
          "memory_distill"
        );
      } catch {
        // Non-critical event emission
      }
    },
    evaluate,
    onTerminal: ({ sessionId: sid, success, outcome, completedAt }) => {
      try {
        eventBus.emit({
          // The row's verdict: a discarded distill is a failed distill.
          type:
            success && outcome === "answered"
              ? "session:completed"
              : "session:failed",
          projectId: input.projectId,
          data: { sessionId: sid, agentType: "memory_distill" },
          timestamp: completedAt,
        });
      } catch {
        // Non-critical event emission
      }

      if (discard) {
        try {
          emitMemoryDiscarded(input.projectId, {
            source: "distill",
            reason: discard,
            sessionId: sid,
          });
        } catch {
          // Non-critical: the session row already carries the failure.
        }
        return;
      }
      if (!stored) {
        return;
      }

      // Story 3: record who wrote the document and tell every open memory view
      // to re-fetch — the single channel every other write path uses.
      try {
        recordMemoryWriteProvenance(input.projectId, {
          source: "distill",
          sessionId: sid,
        });
        eventBus.emit({
          type: "memory:changed",
          projectId: input.projectId,
          data: { source: "distill" },
          timestamp: new Date().toISOString(),
        });
        createMemoryDistilledNotification({
          projectId: input.projectId,
          sessionId: sid,
          sourceSessionId: input.sourceSessionId,
        });
      } catch (error) {
        console.warn(
          "[memory-distill] Failed to record the distilled memory write",
          error
        );
      }

      if (sourceContext?.epicId) {
        const epicStatus =
          db
            .select({ status: epics.status })
            .from(epics)
            .where(eq(epics.id, sourceContext.epicId))
            .get()?.status ?? "done";
        // from == to: nothing moved, the entry records the memory update
        // (same auditing pattern as the asked_question hold).
        logTransition({
          projectId: input.projectId,
          epicId: sourceContext.epicId,
          fromStatus: epicStatus,
          toStatus: epicStatus,
          actor: "system",
          reason: MEMORY_UPDATED_REASON,
          sessionId: sid,
        });
      }
    },
  });

  return { sessionId };
}
