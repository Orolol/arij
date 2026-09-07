import type { VerificationReport } from "@/lib/verify/verify-constants";
import type {
  PipelineRunnerCallbacks,
  PipelineStageHandle,
  PipelineStageKind,
  PipelineStageRequest,
  PipelineTerminalState,
  PipelineTerminalSummary,
  RunPipelineOptions,
} from "./runner";

/**
 * Per-run state and helpers shared by the runner's stage handlers.
 *
 * `runPipeline` (runner.ts) owns the loop; the policies — dispatch guards
 * (runner-dispatch.ts), the retry ladder (runner-retry.ts), the cancel watch
 * (runner-cancel-watch.ts) — and the per-stage success handlers
 * (runner-stage-code.ts, runner-stage-grading.ts, runner-stage-review.ts)
 * read and write this one record in place. The transition matrix therefore
 * stays a single state machine; only its source is spread over files that
 * each cover one stage.
 */

/** Mutable state of one pipeline run. */
export interface PipelineRunState {
  /** Every session the run owns, in dispatch order (initial build first). */
  sessionIds: string[];
  /** Stage currently in flight (or just settled). */
  stage: PipelineStageKind;
  /** 1-based attempt of the current stage on the retry ladder. */
  stageAttempt: number;
  fixCycles: number;
  /** Most recent successful code-writing session (initial build or fix). */
  lastCodeSessionId: string | null;
  /** Findings window start of the current review stage (ISO). */
  reviewStageStartedAt: string;
  /** Handle of the stage currently in flight (or just settled). */
  handle: PipelineStageHandle;
  /** Request that produced `handle`; null while the initial build runs. */
  currentRequest: PipelineStageRequest | null;
  /**
   * Passing mechanical evidence from the latest code stage. Grading sits
   * between that stage and review, so the report has to outlive the dispatch
   * that carried it in order to still reach the reviewer's prompt.
   */
  lastVerificationReport: VerificationReport | undefined;
}

export interface PipelineRunContext {
  readonly options: RunPipelineOptions;
  readonly callbacks: PipelineRunnerCallbacks;
  /** Cadence of the cancel watch (RunPipelineOptions.cancelPollIntervalMs). */
  readonly pollMs: number;
  readonly state: PipelineRunState;
  /** `options.readSessionStatus` that never throws (null on error). */
  readStatusSafe(sessionId: string): string | null;
  /** Builds the terminal summary, fires onFinish, and returns it. */
  finish(
    state: PipelineTerminalState,
    reason: string | null
  ): PipelineTerminalSummary;
}

/**
 * Outcome of one mechanical step inside the code-stage handler (deterministic
 * verification, regression gate): the run ended, a fix stage was dispatched
 * (hand control back to the loop), or the step passed and the handler goes
 * on to the next step.
 */
export type PipelineStepOutcome =
  | { kind: "terminal"; summary: PipelineTerminalSummary }
  | { kind: "dispatched" }
  | { kind: "proceed" };

/** Initial state of a run: the dispatching route's build session in flight. */
export function createPipelineRunContext(
  options: RunPipelineOptions
): PipelineRunContext {
  const callbacks = options.callbacks ?? {};
  const pollMs = options.cancelPollIntervalMs ?? 2000;

  const state: PipelineRunState = {
    sessionIds: [options.initialBuild.sessionId],
    stage: "build",
    stageAttempt: 1,
    fixCycles: 0,
    lastCodeSessionId: null,
    reviewStageStartedAt: "",
    handle: {
      sessionId: options.initialBuild.sessionId,
      settled: options.initialBuild.settled,
      escalatedToProvider: null,
    },
    currentRequest: null,
    lastVerificationReport: undefined,
  };

  return {
    options,
    callbacks,
    pollMs,
    state,
    readStatusSafe: (sessionId) => {
      try {
        return options.readSessionStatus(sessionId);
      } catch {
        return null;
      }
    },
    finish: (terminalState, reason) => {
      const summary: PipelineTerminalSummary = {
        state: terminalState,
        reason,
        sessionIds: [...state.sessionIds],
        fixCycles: state.fixCycles,
      };
      callbacks.onFinish?.(summary);
      return summary;
    },
  };
}
