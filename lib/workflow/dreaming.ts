/**
 * Dreaming — cross-session distillation of the project memory.
 *
 * `memory_distill` (lib/workflow/memory-distill.ts) is a per-session pass: one
 * build finishes, one agent folds what it taught into the memory document.
 * Dreaming is the transversal pass: it reads the last N TERMINAL sessions
 * across MANY tickets — successes and failures — and rewrites the memory
 * around what no single session can show (recurring agent mistakes, traps the
 * codebase keeps setting, strategies that actually land).
 *
 * Shape (deliberately the same as the distill and the spec auto-rewrite, so
 * all three read alike):
 *   collector → guard matrix → queued 'dreaming' session → per-project
 *   scheduler closure → guarded memory replacement.
 *
 * Notable choices, all load-bearing:
 *   - the digest NEVER embeds a session's raw CLI stream. What it reads is the
 *     TAIL of the final response (the `response`/`output` chunks, not `raw`),
 *     plus the signals that carry a lesson — each capped, and the whole thing
 *     cut to DREAM_DIGEST_MAX_CHARS by a fair (water-filling) allocation so one
 *     verbose session cannot starve the rest — see lib/workflow/dreaming-digest.ts;
 *   - NO epicId on the session row (same trick as lib/pipeline/forensic.ts):
 *     a background project-level pass must never occupy an epic's concurrency
 *     slot, so it can never block a ticket;
 *   - batchRunId IS inherited when a night run triggers the dream, because the
 *     night cost cap and the morning summary query `agent_sessions.batch_run_id`
 *     and nothing else — the tag alone is the entire integration (same pitfall
 *     documented on memory-distill);
 *   - the memory is replaced ONLY when the session actually delivers
 *     (`outcome === 'answered'` with non-empty output) AND the text that would
 *     be stored still carries the four imposed sections — a cap-truncated or
 *     unstructured document is refused rather than saved. The previous memory is
 *     snapshotted in the SAME transaction (documents row, kind
 *     'memory_archive'), so a failed save can never burn the snapshot — and
 *     only when the stored memory is still the one the dream reasoned from, so
 *     a human edit made mid-dream is never silently overwritten;
 *   - that write happens in the session's `evaluate` hook, BEFORE the row is
 *     finalised, so a dream that answered but was not stored (refused
 *     structure, a human edit mid-run, a failed save) ends `failed` with the
 *     reason in its `error` column, and a `memory:discarded` event tells the
 *     memory panel — instead of a "successful" row over an unchanged memory.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  dispatchBackgroundSession,
  type BackgroundSessionRun,
  type BackgroundSessionVerdict,
} from "@/lib/agent-sessions/dispatch-background-session";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import { buildDreamingPrompt } from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  enforceMemoryCap,
  getProjectMemoryContent,
  isProjectMemoryChangedError,
  replaceProjectMemoryWithSnapshot,
  sanitizeMemoryDocument,
} from "@/lib/documents/memory";
import { recordMemoryWriteProvenance } from "@/lib/documents/memory-provenance";
import {
  emitMemoryDiscarded,
  emitProjectSessionStarted,
} from "@/lib/events/emit";
import { eventBus } from "@/lib/events/bus";
import {
  DREAMING_AGENT_TYPE,
  DREAMING_LOG_PREFIX,
  type DreamGuardCode,
  type MemoryDiscardReason,
} from "./dreaming-constants";
import { hasPendingMemoryWriter } from "./memory-writer-lock";
import { validateDreamedMemoryStructure } from "./dreaming-digest";
import {
  collectDreamDigest,
  type CollectDreamDigestOptions,
} from "./dreaming-collector";
import {
  evaluateDreamGuards,
  evaluateNightRunDreamGuards,
  WRITER_PENDING_REASON,
  type DreamDecision,
} from "./dreaming-policy";
import { isDreamingAfterNightRunEnabled, recordDreamCutoff } from "./dreaming-settings";

// Stable facade for callers; collecting evidence never dispatches or writes memory.
export { collectDreamDigest, selectDreamCandidates } from "./dreaming-collector";
export type { CollectDreamDigestOptions, DreamDigestResult } from "./dreaming-collector";
export { evaluateDreamGuards, evaluateNightRunDreamGuards } from "./dreaming-policy";
export type { DreamDecision, DreamGuardDecision } from "./dreaming-policy";
export { findLastDreamCutoff, recordDreamCutoff, isDreamingAfterNightRunEnabled } from "./dreaming-settings";

const POLL_INTERVAL_MS = 2000;

/**
 * The night-run trigger's answer: the pure guard decision, plus the settlement
 * of the dream it started (absent when it started none). Kept out of
 * `DreamDecision` so the guard matrix stays a pure type.
 */
export interface NightRunDreamTriggerResult extends DreamDecision {
  settled?: Promise<void>;
}

export interface NightRunDreamContext {
  /** The run's abort reason, verbatim from the engine (null = normal finish). */
  abortReason?: string | null;
  /** Effective cost cap of the run, or null when it ran uncapped. */
  costCapUsd?: number | null;
  /** What the run had spent when it closed (SUM over its tagged sessions). */
  spentUsd?: number;
}

/**
 * Night-run trigger, invoked (fire-and-forget) from the night engine's
 * terminal choke point. Best-effort by design: it must never throw into the
 * run's finish path, and every denial is silent except for the journal line.
 *
 * Cost accounting, precisely:
 *   - the run id is inherited as `batch_run_id`, so the dream's spend shows up
 *     in every DB-derived total for the run (the summary dialog, the run
 *     detail, `sumNightRunCost`);
 *   - the wave engine's own cap check cannot stop it (the run is already
 *     over), so the cap is re-applied HERE, before dispatch, from the numbers
 *     the caller measured at finish time;
 *   - the one number it cannot appear in is the morning-summary NOTIFICATION,
 *     which is sent before the dream starts. That is the accepted trade: the
 *     summary must not wait minutes for a dream, and the deep link it carries
 *     opens the detail view, which re-derives the total from the database and
 *     therefore does include it.
 */
export async function maybeDreamAfterNightRun(
  projectId: string,
  runId: string,
  context: NightRunDreamContext = {}
): Promise<NightRunDreamTriggerResult> {
  try {
    const enabled = isDreamingAfterNightRunEnabled();
    const decision = evaluateNightRunDreamGuards({
      enabled,
      abortReason: context.abortReason ?? null,
      costCapUsd: context.costCapUsd ?? null,
      spentUsd: context.spentUsd ?? 0,
    });
    if (!decision.allowed) {
      // Only the cost/stop denials are worth a journal line; "the setting is
      // off" is the default state of every project and would be pure noise.
      if (enabled) {
        console.info(
          `${DREAMING_LOG_PREFIX} skipped for project ${projectId}` +
            ` (night_run ${runId}): ${decision.reason}`
        );
      }
      return decision;
    }
    const result = await dispatchDreamingSession({
      projectId,
      batchRunId: runId,
      trigger: "night_run",
    });
    return {
      allowed: result.dispatched,
      reason: result.reason,
      settled: result.settled,
    };
  } catch (error) {
    console.warn(
      `${DREAMING_LOG_PREFIX} Night-run trigger failed:`,
      (error as Error).message
    );
    return { allowed: false, reason: "dreaming trigger failed" };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface DispatchDreamingInput {
  projectId: string;
  /** Night run that caused the dream; tagged on the session row. */
  batchRunId?: string | null;
  /** What asked for this dream — journal context only. */
  trigger?: "manual" | "night_run";
  /** Collector overrides (tests). */
  collect?: CollectDreamDigestOptions;
}

export interface DispatchDreamingResult {
  /** Null when a guard refused — see `reason`. */
  sessionId: string | null;
  dispatched: boolean;
  reason: string;
  /** The guard's verdict as a code — what a UI translates. */
  code: DreamGuardCode;
  /** Sessions the digest carries (0 on a refusal). */
  sessionsAnalyzed: number;
  /**
   * Resolution of the run this dispatch launched: never rejects, and resolves
   * only AFTER the terminal hook has run — so a caller that awaits it sees the
   * document the session wrote (or the proof that it wrote nothing). A guard
   * refusal resolves immediately: there was no run to wait for.
   *
   * Exposed for the same reason `dispatchBackgroundSession` exposes its own
   * `settled`: the callers that need the effect to have landed (the tests, and
   * any future caller chaining a second step) must be able to await it instead
   * of sleeping for a while and hoping.
   */
  settled: Promise<void>;
}

/**
 * The English sentence the dream's session row carries in its `error` column
 * when its output was not stored — the session page shows it verbatim. The
 * panel gets the CODE (on the `memory:discarded` event) and its own copy.
 */
const DREAM_DISCARD_ERRORS: Record<MemoryDiscardReason, string> = {
  no_output:
    "The dream finished without returning a memory document — the memory was left unchanged.",
  invalid_structure:
    "The dreamed memory did not match the required four-section structure once capped — it was discarded and the memory was left unchanged.",
  memory_changed:
    "The memory was edited while the dream ran — the edit was kept and the dream's output discarded.",
  save_failed:
    "The dreamed memory could not be saved — the memory was left unchanged.",
};

/**
 * Creates a queued 'dreaming' session and submits its launch closure to the
 * per-project scheduler. Resolves as soon as the row exists; the memory lands
 * in the database when the closure finishes — and only if the session
 * delivered.
 *
 * Throws when the project does not exist. Guard refusals are NOT errors: they
 * come back as `dispatched: false` with a reason, journalled on the way out.
 */
export async function dispatchDreamingSession(
  input: DispatchDreamingInput
): Promise<DispatchDreamingResult> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) {
    throw new Error("Project not found");
  }

  const pending = hasPendingMemoryWriter(input.projectId);
  const digest = pending
    ? null
    : collectDreamDigest(input.projectId, input.collect ?? {});

  const decision = evaluateDreamGuards({
    hasPendingMemoryWriter: pending,
    sessionCount: digest?.includedCount ?? 0,
  });

  if (!decision.allowed) {
    // The journalled no-op: a dream that finds nothing new must leave a trace
    // (why nothing happened) without spending a session on it.
    console.info(
      `${DREAMING_LOG_PREFIX} skipped for project ${input.projectId}` +
        ` (${input.trigger ?? "manual"}): ${decision.reason}`
    );
    return {
      sessionId: null,
      dispatched: false,
      reason: decision.reason,
      code: decision.code,
      sessionsAnalyzed: 0,
      settled: Promise.resolve(),
    };
  }

  const collected = digest!;
  const currentMemory = getProjectMemoryContent(input.projectId);
  const systemPrompt = await resolveAgentPrompt(
    DREAMING_AGENT_TYPE,
    input.projectId
  );
  // No per-call override: the dreaming agent is chosen in Agent Config, the
  // one surface every background writer reads its agent from.
  const resolvedAgent = resolveAgentByNamedId(
    DREAMING_AGENT_TYPE,
    input.projectId,
    null
  );

  const prompt = buildDreamingPrompt(
    // Defensive `memory: null`: this builder frames the current memory itself
    // and does not inject the standard section today — the null keeps a future
    // `withProjectMemory` wrapping from quietly adding the document twice.
    { ...project, memory: null },
    currentMemory,
    {
      digest: collected.text,
      sessionCount: collected.includedCount,
      sinceIso: collected.sinceIso,
      truncatedCount: collected.truncatedCount,
      droppedCount: collected.droppedCount,
    },
    systemPrompt
  );

  // Re-check under NO await: the guard above ran before `resolveAgentPrompt`,
  // and two triggers firing together (the Docs button while a night run
  // finishes, or an auto-distill racing this dream) could both have passed it
  // during that suspension. From here to the insert everything is synchronous,
  // so on Node's single thread this second look is the one that actually makes
  // "never two memory rewrites at once" true rather than merely likely.
  if (hasPendingMemoryWriter(input.projectId)) {
    console.info(
      `${DREAMING_LOG_PREFIX} skipped for project ${input.projectId}` +
        ` (${input.trigger ?? "manual"}): ${WRITER_PENDING_REASON} (raced)`
    );
    return {
      sessionId: null,
      dispatched: false,
      reason: WRITER_PENDING_REASON,
      code: "writer_pending",
      sessionsAnalyzed: 0,
      settled: Promise.resolve(),
    };
  }

  // Set by `evaluate` when a delivered dream was NOT stored; read by
  // `onTerminal`, which always runs after it, to announce the discard.
  let discard: MemoryDiscardReason | null = null;
  let stored = false;

  /**
   * The memory write, done BEFORE the session row is finalised so the row can
   * tell the truth: a dream that answered but whose document was refused or
   * lost is a failed dream for this workflow, and its row must not claim
   * success over an unchanged memory (the rule dispatch-background-session
   * states, and spec-update follows). The write itself is synchronous, so the
   * whole decision fits in the hook.
   */
  const evaluate = ({
    sessionId: sid,
    result,
    outcome,
  }: BackgroundSessionRun): BackgroundSessionVerdict => {
    // Silent runs, asked questions and failures leave the memory exactly as it
    // was, and keep the provider's own verdict: nothing was discarded, the run
    // simply did not deliver.
    if (!result?.success || outcome !== "answered") {
      return { success: !!result?.success, error: result?.error ?? null };
    }

    const output = sanitizeMemoryDocument(resolveSessionOutput(result, sid, ""));
    if (!output) {
      discard = "no_output";
      return { success: false, error: DREAM_DISCARD_ERRORS.no_output };
    }

    // Validate what would ACTUALLY BE STORED, not what the agent produced.
    // `saveProjectMemory` truncates at the cap, so an over-long response can
    // arrive with all four sections and land with its last one cut off — a
    // document that stops mid-sentence, injected into every future prompt,
    // with the digest window marked as learned. Checking the cap-effective
    // text catches that as well as an agent that ignored the contract.
    const structure = validateDreamedMemoryStructure(enforceMemoryCap(output));
    if (!structure.valid) {
      // Nothing stored, cutoff unmoved, so the next dream reads the same
      // sessions and gets another attempt. The rejected text stays readable
      // on the session page.
      console.warn(
        `${DREAMING_LOG_PREFIX} discarded for project ${input.projectId}:` +
          ` the dreamed memory did not match the required structure` +
          ` (${structure.reason}); session ${sid}`
      );
      discard = "invalid_structure";
      return {
        success: false,
        error: `${DREAM_DISCARD_ERRORS.invalid_structure} (${structure.reason})`,
      };
    }

    try {
      // Snapshot and replacement commit together or not at all. A dream
      // rewrites the whole document, so the pre-dream text is the only way
      // back — and archiving it separately would let a failed save burn that
      // snapshot while leaving the live memory untouched.
      //
      // `expectedPrevious` is the memory this dream actually REASONED FROM
      // (captured minutes ago, at prompt time). A dream runs long enough for
      // someone to save an edit in the Docs tab meanwhile; replacing blindly
      // would throw that edit away in favour of text derived from the version
      // before it. The human edit is the newer intent and wins — a dream can
      // just be run again.
      replaceProjectMemoryWithSnapshot(input.projectId, output, {
        expectedPrevious: currentMemory,
      });
    } catch (error) {
      // Either way the window deliberately does NOT advance: a dream whose
      // output was never stored taught the project nothing, so the next dream
      // must read the same sessions again rather than skip past them.
      if (isProjectMemoryChangedError(error)) {
        discard = "memory_changed";
        return { success: false, error: DREAM_DISCARD_ERRORS.memory_changed };
      }
      console.error(`${DREAMING_LOG_PREFIX} Failed to save dreamed memory`, error);
      discard = "save_failed";
      return { success: false, error: DREAM_DISCARD_ERRORS.save_failed };
    }

    stored = true;
    return { success: true, error: null };
  };

  // Deliberately no epicId (see the module docblock): a dream spans every
  // ticket, so pinning it to one would both lie and hold that epic's
  // concurrency slot for the whole run.
  const { sessionId, settled } = dispatchBackgroundSession({
    agentType: DREAMING_AGENT_TYPE,
    projectId: input.projectId,
    prompt,
    resolvedAgent,
    mode: "plan",
    cwd: project.gitRepoPath || process.cwd(),
    pollIntervalMs: POLL_INTERVAL_MS,
    logPrefix: DREAMING_LOG_PREFIX,
    session: { batchRunId: input.batchRunId ?? null },
    onQueued: ({ sessionId: sid }) => {
      try {
        emitProjectSessionStarted(input.projectId, sid, DREAMING_AGENT_TYPE);
      } catch {
        // Non-critical event emission
      }
    },
    evaluate,
    onTerminal: ({ sessionId: sid, success, outcome, completedAt }) => {
      try {
        eventBus.emit({
          // The row's verdict, not the provider's: a discarded dream is a
          // failed dream, and the lifecycle event must agree with the row.
          type:
            success && outcome === "answered"
              ? "session:completed"
              : "session:failed",
          projectId: input.projectId,
          data: { sessionId: sid, agentType: DREAMING_AGENT_TYPE },
          timestamp: completedAt,
        });
      } catch {
        // Non-critical event emission
      }

      if (discard) {
        try {
          emitMemoryDiscarded(input.projectId, {
            source: "dreaming",
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

      // Record who wrote the document, and tell every open memory
      // view to re-fetch — the single channel every other write path uses.
      try {
        recordMemoryWriteProvenance(input.projectId, {
          source: "dreaming",
          sessionId: sid,
        });
        eventBus.emit({
          type: "memory:changed",
          projectId: input.projectId,
          data: { source: "dreaming" },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.warn(
          `${DREAMING_LOG_PREFIX} Failed to record the dream memory write`,
          error
        );
      }

      // The single place the window advances — after, and only after, the memory
      // document actually changed. Stamped with the COLLECTION instant, so
      // sessions that reached a terminal state while this dream was running stay
      // inside the next window instead of falling through the crack between
      // "collected" and "finished".
      try {
        recordDreamCutoff(input.projectId, collected.collectedAtIso);
      } catch (error) {
        // Losing the cutoff costs a re-read, never a loss — leave it noisy but
        // non-fatal.
        console.warn(
          `${DREAMING_LOG_PREFIX} Failed to record the dream cutoff`,
          error
        );
      }

    },
  });

  return {
    sessionId,
    dispatched: true,
    reason: decision.reason,
    code: decision.code,
    sessionsAnalyzed: collected.includedCount,
    settled: settled.then(() => undefined),
  };
}
