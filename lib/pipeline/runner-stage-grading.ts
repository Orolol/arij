import { PIPELINE_REASONS } from "./constants";
import type {
  PipelineGradingAssessment,
  PipelineStageResult,
  PipelineTerminalSummary,
} from "./runner";
import type { PipelineRunContext } from "./runner-context";
import { dispatchStage } from "./runner-dispatch";
import { handleStageFailure } from "./runner-retry";

/**
 * Grading stage success handler (opt-in acceptance grading).
 *
 * Grading success is assessed only from the exact structured report id
 * returned by this stage. A rubric-free target is an intentional no-op that
 * goes straight to review; missed criteria spend a fix cycle carrying the
 * criterion and its evidence; an unreadable report is a failed attempt on
 * the ladder.
 *
 * Returns the terminal summary when the run ended here, or null when the
 * next stage is in flight.
 */
export async function handleGradingStageSuccess(
  ctx: PipelineRunContext,
  result: PipelineStageResult
): Promise<PipelineTerminalSummary | null> {
  const { options, callbacks, state } = ctx;

  if (result.gradingSkipped) {
    return dispatchStage(ctx, {
      stage: "review",
      attempt: 1,
      fixCycle: state.fixCycles,
      previousAttemptSessionId: null,
      lastCodeSessionId: state.lastCodeSessionId,
      // Grading sits between the code stage and review, so the passing
      // mechanical evidence has to survive the hop to reach the reviewer.
      ...(state.lastVerificationReport
        ? { verificationReport: state.lastVerificationReport }
        : {}),
    });
  }

  let grading: PipelineGradingAssessment;
  try {
    if (!result.gradingReportId || !options.assessGrading) {
      throw new Error("Grading stage completed without a readable report");
    }
    grading = await options.assessGrading({
      sessionId: state.handle.sessionId ?? "",
      reportId: result.gradingReportId,
    });
  } catch {
    return handleStageFailure(ctx);
  }

  if (grading.missed.length === 0) {
    callbacks.onTrace?.(PIPELINE_REASONS.gradingPassed, state.handle.sessionId);
    return dispatchStage(ctx, {
      stage: "review",
      attempt: 1,
      fixCycle: state.fixCycles,
      previousAttemptSessionId: null,
      lastCodeSessionId: state.lastCodeSessionId,
      // Grading sits between the code stage and review, so the passing
      // mechanical evidence has to survive the hop to reach the reviewer.
      ...(state.lastVerificationReport
        ? { verificationReport: state.lastVerificationReport }
        : {}),
    });
  }

  if (state.fixCycles >= options.maxFixCycles) {
    callbacks.onTrace?.(
      PIPELINE_REASONS.failedGrading(grading.missed.length, state.fixCycles),
      state.handle.sessionId
    );
    try {
      options.parkRejectedTicket?.(
        state.lastCodeSessionId,
        "Acceptance grading found missed criteria after the fix-cycle budget was exhausted"
      );
    } catch (parkError) {
      console.warn(
        "[pipeline] Failed to park grading-rejected ticket:",
        parkError instanceof Error ? parkError.message : parkError
      );
    }
    return ctx.finish(
      "failed",
      `${grading.missed.length} acceptance ${grading.missed.length === 1 ? "criterion remains" : "criteria remain"} missed after ${state.fixCycles} fix cycles`
    );
  }

  state.fixCycles += 1;
  callbacks.onTrace?.(
    PIPELINE_REASONS.gradingMissed(
      grading.missed.length,
      state.fixCycles,
      options.maxFixCycles
    ),
    state.handle.sessionId
  );
  return dispatchStage(ctx, {
    stage: "fix",
    attempt: 1,
    fixCycle: state.fixCycles,
    previousAttemptSessionId: null,
    lastCodeSessionId: state.lastCodeSessionId,
    gradingFailure: {
      reportId: grading.reportId,
      summary: grading.summary,
      missed: grading.missed,
    },
  });
}
