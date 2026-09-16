import type { PipelineStage, PipelineState } from "./constants";
import { PIPELINE_REASONS } from "./constants";
import type { ReviewVerdictSource } from "./findings";
import type { VerifyGate } from "./regression-gate";
import type { RegressionReportPayload } from "@/lib/verify/regression-report";
import type { VerificationResult } from "@/lib/verify/runner";
import type {
  VerificationReport,
  VerifyCommandResult,
} from "@/lib/verify/verify-constants";
import type {
  GradingEntry,
  GradingFailureContext,
} from "@/lib/grading/report";
import { awaitStageSettled } from "./runner-cancel-watch";
import { createPipelineRunContext, sizeStageBudget } from "./runner-context";
import { handleStageFailure } from "./runner-retry";
import { handleCodeStageSuccess } from "./runner-stage-code";
import { handleGradingStageSuccess } from "./runner-stage-grading";
import { handleReviewStageSuccess } from "./runner-stage-review";

/**
 * Autonomous pipeline state machine (build → review → auto-fix → forensic).
 *
 * Wave-runner-shaped engine: `runPipeline` is a pure async function that
 * owns the chaining logic and NOTHING else. Every side effect — session
 * creation, DB writes, activity logging, registry updates — lives in the
 * injected stage launchers and callbacks, so the whole transition matrix is
 * unit-testable with fakes (see wave-runner.ts for the precedent).
 *
 * Chaining works on settled promises: each stage launcher returns a handle
 * whose `settled` promise resolves (never rejects) when the stage session
 * reaches a terminal state — the same contract as `WaveLaunchHandle` and the
 * batch build route's settle wrapper. The runner awaits one stage at a time;
 * a run therefore holds at most one scheduler slot and can never deadlock a
 * per-project budget of 1.
 *
 * The terminal-hook slot (lib/agent-sessions/terminal-hooks.ts) is
 * deliberately NOT used: it is a single slot already consumed by memory
 * auto-distill, and launch closures owning the session lifetime is the
 * codebase's native pattern.
 *
 * Callbacks are invoked synchronously and must not throw (the caller wraps
 * its own side effects) — same convention as WaveRunnerCallbacks.
 *
 * This module owns the contract (the exported types) and the loop. The
 * engine is decomposed along the stage boundaries, one module each:
 *   runner-context.ts                    — per-run state + finish/readStatus
 *   runner-cancel-watch.ts               — cancellation policy (queued-stop rescue)
 *   runner-dispatch.ts                   — session cap, target-conflict and
 *                                          review-status guards, stage dispatch
 *   runner-retry.ts                      — retry ladder + forensic post-mortem
 *   runner-stage-code.ts                 — build/fix success → verify → gate → next
 *   runner-deterministic-verification.ts — Arij-owned test/lint/build commands
 *   runner-regression-gate.ts            — bug-ticket red→green gate
 *   runner-stage-grading.ts              — acceptance grading (opt-in)
 *   runner-stage-review.ts               — blocking-findings assessment
 */

/**
 * Terminal per-stage result. Shape pinned by the pipeline contract (I2):
 * the build routes' settle wrappers and the forensic module both resolve
 * this structurally (WaveTicketResult family). Settled promises NEVER
 * reject.
 */
export interface PipelineStageResult {
  sessionId: string;
  success: boolean;
  /** Session/workflow verdict (answered, asked_question, silent, error, or transition_refused). */
  outcome: string | null;
  error: string | null;
  /** Exact structured report produced by a grading stage. */
  gradingReportId?: string | null;
  /** A rubric-free epic/story is a successful, journalled no-op. */
  gradingSkipped?: boolean;
}

/** Stages the retry ladder applies to (forensic is dispatch-once). */
export type PipelineStageKind = Exclude<PipelineStage, "forensic">;

/** Handle returned by the injected stage launcher. */
export interface PipelineStageHandle {
  /** Null when the dispatch itself failed before a session row existed. */
  sessionId: string | null;
  /** Resolves (never rejects) when the stage session reaches a terminal state. */
  settled: Promise<PipelineStageResult>;
  /**
   * Set when this attempt moved DOWN one rank of a composite agent. Both ends
   * travel, because an activity entry that names only the agent now running
   * cannot tell the reader which agent was abandoned — and that is the half
   * that explains the run.
   */
  compositeDescent?: { from: string; to: string } | null;
}

/** What the runner asks the stage launcher to dispatch. */
export interface PipelineStageRequest {
  stage: PipelineStageKind;
  /** 1-based attempt within the stage (the retry ladder index). */
  attempt: number;
  /** 1-based fix cycle this dispatch belongs to (fix stages; else current count). */
  fixCycle: number;
  /**
   * Failed previous attempt of THIS stage. A simple agent resumes it on
   * attempt 2 when the machinery allows; a composite never resumes, because
   * attempt 2 is a different agent. Null on attempt 1.
   */
  previousAttemptSessionId: string | null;
  /**
   * Why the ladder advanced to this attempt — the previous attempt's verdict
   * (`failed`, `silent`, `transition_refused`). Absent on attempt 1. Used in
   * the composite rank-down activity entry, which has to say what the descent
   * was FOR.
   */
  descentReason?: string;
  /**
   * Most recent successful code-writing session of the run (initial build or
   * previous fix). Fix stages resume it on attempt 1.
   */
  lastCodeSessionId: string | null;
  /**
   * Set on a fix dispatch triggered by the mechanical regression gate
   * (bug tickets): the exact red→green verdict so the fix prompt carries
   * the precise failure reason. Null/absent for every other dispatch.
   */
  verificationFailure?: { kind: "regression"; report: RegressionReportPayload } | { kind: "command"; command: VerifyCommandResult };
  /**
   * Passing mechanical evidence appended to this review stage's prompt.
   * Deliberately the client-safe report shape, not the runner's result: the
   * prompt only projects `commands`, and Full Auto forwards a row it read
   * back from `verify_reports` rather than one it just executed.
   */
  verificationReport?: VerificationReport;
  /** Missed acceptance criteria that caused this fix dispatch. */
  gradingFailure?: GradingFailureContext | null;
}

/** Result of resolving and, when configured, running deterministic checks. */
export interface PipelineDeterministicVerificationOutcome {
  /**
   * False when verify_commands is absent/empty (the strict passthrough path)
   * or when the checks could not apply; `skipReason` distinguishes the two
   * so the operator sees why nothing ran.
   */
  ran: boolean;
  result: VerificationResult | null;
  /** Present when configured checks were skipped for an applicability fault. */
  skipReason?: string;
}

/** Verdict of the blocking-findings assessment after a successful review. */
export interface PipelineReviewAssessment {
  blocking: boolean;
  /** Open [critical]/[major] agent findings filed during the stage window. */
  blockingCount: number;
  /**
   * Which channel decided: `structured` when the reviewer's persisted
   * submit_findings verdict did, `prose` for the fallback path,
   * `unverifiable` when the reviewer had the structured channel and filed
   * nothing on it (blocking on missing evidence, not on a finding).
   */
  verdictSource?: ReviewVerdictSource;
  /** The persisted submit_findings verdict, when the reviewer filed one. */
  structuredVerdict?: string | null;
  /**
   * The reviewer had the structured channel and nothing came through it.
   * Blocking, but with no finding to fix — so the runner re-REVIEWS through
   * the stage ladder instead of dispatching a fix agent.
   */
  unverifiable?: boolean;
}

export interface PipelineGradingAssessment {
  reportId: string;
  summary: string;
  gradings: GradingEntry[];
  missed: GradingEntry[];
}

/** Pre-dispatch guard probe (target conflicts + review-status guard). */
export interface PipelineGuardCheck {
  /**
   * Active (queued|running) session on the run's target that this run did
   * not create, else null. A conflict fails the run: another agent took the
   * ticket.
   */
  conflictSessionId: string | null;
  /**
   * Current status of the run's review target — the epic for epic-scoped
   * runs, the story for story-scoped runs (mirror of the respective review
   * route guards). The review stage requires "review" | "done".
   */
  reviewTargetStatus: string | null;
}

export interface PipelineForensicHandle {
  /** Null when the forensic dispatch was refused or threw. */
  sessionId: string | null;
  settled: Promise<PipelineStageResult>;
}

export type PipelineTerminalState = Extract<
  PipelineState,
  "succeeded" | "failed" | "paused_question" | "cancelled"
>;

export interface PipelineTerminalSummary {
  state: PipelineTerminalState;
  reason: string | null;
  /** Every session the run owned, in dispatch order (initial build first). */
  sessionIds: string[];
  fixCycles: number;
}

export interface PipelineRunnerCallbacks {
  /** The run entered a new running state (stage dispatch imminent). */
  onStageChange?(
    state: PipelineState,
    stage: PipelineStage,
    stageAttempt: number,
    fixCycles: number
  ): void;
  /**
   * The attempt budget of the stage being entered was sized (once per stage
   * entry, initial build included). Lets the registry show "attempt n/max"
   * with the budget the ladder actually climbs.
   */
  onStageBudget?(stage: PipelineStageKind, maxAttempts: number): void;
  /** A stage session was created (initial build excluded — the caller registered it). */
  onSessionAdded?(sessionId: string, stage: PipelineStage): void;
  /** One activity-trace line (exact PIPELINE_REASONS string). */
  onTrace?(reason: string, sessionId: string | null): void;
  /** The run reached a terminal state. */
  onFinish?(summary: PipelineTerminalSummary): void;
}

export interface RunPipelineOptions {
  /**
   * Per-stage attempt cap for a SIMPLE agent (clamped 1..5 by the caller).
   * A composite ignores it — see `attemptBudget`.
   */
  maxAttempts: number;
  /**
   * Attempts `stage` may spend, asked once per stage entry.
   *
   * A simple agent answers `maxAttempts`: it is retried as itself, so the
   * configured cap is the only bound. A COMPOSITE answers its member count,
   * because each attempt descends a rank and there is nothing below the last
   * member. Absent — every pre-existing caller — means `maxAttempts` for
   * every stage, which is byte-for-byte the historical behaviour.
   */
  attemptBudget?(stage: PipelineStageKind): number | Promise<number>;
  /** Review → fix → review cycle cap (0 = report-only). */
  maxFixCycles: number;
  /** Hard ceiling on sessions the run may own (PIPELINE_MAX_SESSIONS_PER_RUN). */
  maxSessions: number;
  /** Stage 1: the dispatching route's own build session. */
  initialBuild: {
    sessionId: string;
    settled: Promise<PipelineStageResult>;
  };
  /**
   * Dispatches one review/fix/build-retry stage. A thrown error is treated
   * like a dispatch-refusal (a failed attempt on the ladder).
   */
  launchStage(request: PipelineStageRequest): Promise<PipelineStageHandle>;
  /** Blocking-findings assessment for a successful review stage. */
  assessReview(input: {
    sessionId: string;
    stageStartedAt: string;
  }): Promise<PipelineReviewAssessment>;
  /** Reads and validates the exact report filed by a successful grader. */
  assessGrading?(input: {
    sessionId: string;
    reportId: string;
  }): Promise<PipelineGradingAssessment>;
  /**
   * Reads the stage session's row status. Called after every settle (a
   * 'cancelled' row means the user stopped the run) and by the cancel watch
   * that rescues settles for sessions removed from the scheduler queue.
   */
  readSessionStatus(sessionId: string): string | null;
  /** Pre-dispatch guard probe. `ownSessionIds` = sessions this run created. */
  checkGuards(ownSessionIds: string[]): PipelineGuardCheck;
  /** Dispatches the post-mortem after a stage exhausted its ladder. */
  runForensic(input: {
    deadSessionId: string;
    stage: PipelineStageKind;
    attempts: number;
  }): Promise<PipelineForensicHandle>;
  /**
   * Cadence of the cancel watch while awaiting a settle. A session stopped
   * while still QUEUED is removed from the scheduler, so its launch closure
   * never runs and its settled promise would hang forever — the watch reads
   * the row and synthesizes the settle when it finds 'cancelled'.
   */
  cancelPollIntervalMs?: number;
  callbacks?: PipelineRunnerCallbacks;
  /**
   * Mechanical verify gate run after each successful code stage, before
   * review (lib/pipeline/regression-gate.ts). Absent → no gate: behaviour identical
   * to pre-regression runs.
   */
  runVerifyGate?: VerifyGate;
  /** Opt-in only. False/absent preserves the pre-grader pipeline exactly. */
  gradingEnabled?: boolean;
  /**
   * Arij-owned test/lint/build commands run after every successful code stage.
   * Reports are plain persisted records, never agent sessions, so invoking
   * this callback cannot consume the session ceiling.
   */
  runDeterministicVerification?: (
    lastCodeSessionId: string | null
  ) => Promise<PipelineDeterministicVerificationOutcome>;
  /**
   * Parks a gate-rejected bug back to in_progress (guarded review →
   * in_progress) before the run terminates on regression exhaustion — the
   * board counterpart of the terminal failure. Receives the last code
   * session id for the transition's audit trail. Absent → the ticket keeps
   * whatever status the code stage left it in.
   */
  /**
   * Moves a ticket the code stage already promoted to review back to
   * in_progress. `reason` is written verbatim to the activity log, so each
   * call site passes what actually happened rather than one shared string.
   */
  parkRejectedTicket?: (
    lastCodeSessionId: string | null,
    reason: string
  ) => void;
}

/**
 * Why the ladder is about to advance, in the words the activity entry uses.
 *
 * The three verdicts a composite exists to absorb are named individually
 * because "attempt 2 replaced Sonnet with Codex" is only half an explanation
 * — a run abandoned for delivering NOTHING reads very differently from one
 * abandoned for crashing, and the reader has to be able to tell them apart
 * without opening the dead session.
 */
function descentReasonFor(result: PipelineStageResult): string {
  if (result.outcome === "silent") return "the agent delivered nothing";
  if (result.outcome === "transition_refused") {
    return "its workflow transition was refused";
  }
  return "the session failed";
}

/**
 * Executes one pipeline run to its terminal state. Resolves with the
 * terminal summary; per-stage launch/session failures never reject (they
 * feed the retry ladder). A rejection here is an engine bug.
 */
export async function runPipeline(
  options: RunPipelineOptions
): Promise<PipelineTerminalSummary> {
  const ctx = createPipelineRunContext(options);
  const { callbacks, state } = ctx;

  // The initial build is attempt 1 of the build stage and bypassed
  // `dispatch()`, so this is the only place its ladder can be sized. Without
  // it a build composite's members past `pipeline_max_attempts` are
  // unreachable, and a composite SHORTER than that cap sends `launchStage`
  // asking for a rank that does not exist.
  await sizeStageBudget(ctx, "build");

  // -------------------------------------------------------------------
  // Main loop — one settled stage per iteration.
  // -------------------------------------------------------------------
  for (;;) {
    const result = await awaitStageSettled(ctx, state.handle);

    // User stop wins over whatever the closure reported.
    if (
      state.handle.sessionId &&
      ctx.readStatusSafe(state.handle.sessionId) === "cancelled"
    ) {
      callbacks.onTrace?.(PIPELINE_REASONS.cancelled, state.handle.sessionId);
      return ctx.finish("cancelled", "stopped by user");
    }

    // asked_question at ANY stage pauses the run; the stage closure already
    // held the ticket, notified, and logged via handleAskedQuestionOutcome.
    if (result.outcome === "asked_question") {
      callbacks.onTrace?.(
        PIPELINE_REASONS.pausedQuestion(state.stage),
        state.handle.sessionId
      );
      return ctx.finish(
        "paused_question",
        `agent asked a question (${state.stage})`
      );
    }

    let summary: PipelineTerminalSummary | null;
    if (!result.success) {
      summary = await handleStageFailure(ctx, descentReasonFor(result));
    } else if (state.stage === "build" || state.stage === "fix") {
      summary = await handleCodeStageSuccess(ctx);
    } else if (state.stage === "grading") {
      summary = await handleGradingStageSuccess(ctx, result);
    } else {
      summary = await handleReviewStageSuccess(ctx);
    }
    if (summary) return summary;
  }
}
