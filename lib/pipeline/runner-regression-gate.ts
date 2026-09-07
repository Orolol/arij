import type { RegressionReportPayload } from "@/lib/verify/regression-report";
import { PIPELINE_REASONS } from "./constants";
import type { PipelineRunContext, PipelineStepOutcome } from "./runner-context";
import { dispatchStage } from "./runner-dispatch";
import type { VerifyGateOutcome } from "./verify";

/**
 * Regression gate step of the code stage (bug tickets, opt-in).
 *
 * The mechanical red→green check (RunPipelineOptions.runVerifyGate) runs
 * after deterministic verification and before grading/review. A red gate
 * spends one fix cycle carrying the exact verdict; a command error, an
 * exhausted budget or a crashed gate parks the ticket and fails the run.
 * Absent gate → no-op, behaviour identical to pre-regression runs.
 */
export async function runRegressionGateStep(
  ctx: PipelineRunContext
): Promise<PipelineStepOutcome> {
  const { options, callbacks, state } = ctx;

  let gate: VerifyGateOutcome = { ran: false, passed: null, result: null };
  try {
    if (options.runVerifyGate) {
      gate = await options.runVerifyGate(state.lastCodeSessionId);
    }
  } catch (error) {
    console.warn(
      "[pipeline] Regression gate crashed:",
      error instanceof Error ? error.message : error
    );
    callbacks.onTrace?.(
      PIPELINE_REASONS.failedRegressionGateCrashed,
      state.handle.sessionId
    );
    try {
      options.parkRejectedTicket?.(
        state.lastCodeSessionId,
        "Regression gate crashed before it could verify the branch"
      );
    } catch (parkError) {
      console.warn(
        "[pipeline] Failed to park regression-crashed ticket:",
        parkError instanceof Error ? parkError.message : parkError
      );
    }
    return {
      kind: "terminal",
      summary: ctx.finish("failed", "regression gate crashed"),
    };
  }

  if (gate.ran && !gate.passed && gate.result) {
    const payload: RegressionReportPayload = {
      regression: {
        status: gate.result.status,
        reason: gate.result.reason,
        testFiles: gate.result.testFiles,
        detail: gate.result.detail,
        checkedAt: new Date().toISOString(),
      },
    };

    // command_error means the command failed to execute (environment or
    // configuration fault, e.g. runner missing or timeout). An agent in
    // a fix cycle cannot fix an environment fault — fail immediately
    // rather than burning the fix budget.
    if (gate.result.reason === "command_error") {
      callbacks.onTrace?.(
        PIPELINE_REASONS.failedRegressionCommandError,
        state.handle.sessionId
      );
      try {
        options.parkRejectedTicket?.(
          state.lastCodeSessionId,
          "Regression test command could not run — the branch was never verified"
        );
      } catch (parkError) {
        console.warn(
          "[pipeline] Failed to park regression-rejected ticket:",
          parkError instanceof Error ? parkError.message : parkError
        );
      }
      return {
        kind: "terminal",
        summary: ctx.finish(
          "failed",
          `regression command error: ${gate.result.detail ?? "could not run command"}`
        ),
      };
    }

    if (state.fixCycles >= options.maxFixCycles) {
      callbacks.onTrace?.(
        PIPELINE_REASONS.failedRegression(state.fixCycles),
        state.handle.sessionId
      );
      // The code stage already moved the ticket to review; a gate
      // rejection is the opposite of approval-ready. Park it back in
      // in_progress like the negative-review path does — best effort,
      // it must not change how the run terminates.
      try {
        options.parkRejectedTicket?.(
          state.lastCodeSessionId,
          "Mandatory regression test rejected the branch (red → green)"
        );
      } catch (parkError) {
        console.warn(
          "[pipeline] Failed to park regression-rejected ticket:",
          parkError instanceof Error ? parkError.message : parkError
        );
      }
      return {
        kind: "terminal",
        summary: ctx.finish(
          "failed",
          `mandatory regression test still failing after ${state.fixCycles} fix cycles`
        ),
      };
    }
    state.fixCycles += 1;
    callbacks.onTrace?.(
      PIPELINE_REASONS.regressionFailed(state.fixCycles, options.maxFixCycles),
      state.handle.sessionId
    );
    const summary = await dispatchStage(ctx, {
      stage: "fix",
      attempt: 1,
      fixCycle: state.fixCycles,
      previousAttemptSessionId: null,
      lastCodeSessionId: state.lastCodeSessionId,
      verifyFailure: payload,
    });
    return summary ? { kind: "terminal", summary } : { kind: "dispatched" };
  }

  return { kind: "proceed" };
}
