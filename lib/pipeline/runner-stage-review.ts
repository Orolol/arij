import { PIPELINE_REASONS } from "./constants";
import type { PipelineReviewAssessment, PipelineTerminalSummary } from "./runner";
import type { PipelineRunContext } from "./runner-context";
import { dispatchStage } from "./runner-dispatch";
import { handleStageFailure } from "./runner-retry";

/**
 * Review stage success handler: assess blocking findings.
 *
 * A clean review is the success end-state (green review awaiting human
 * sign-off — the pipeline NEVER auto-approves). Blocking findings spend a
 * fix cycle; an exhausted budget fails the run without forensic; an
 * assessment crash or an unverifiable review with nothing to fix is a
 * failed review attempt on the ladder.
 *
 * Returns the terminal summary when the run ended here, or null when the
 * next stage is in flight.
 */
export async function handleReviewStageSuccess(
  ctx: PipelineRunContext
): Promise<PipelineTerminalSummary | null> {
  const { options, callbacks, state } = ctx;

  let assessment: PipelineReviewAssessment;
  try {
    assessment = await options.assessReview({
      sessionId: state.handle.sessionId ?? "",
      stageStartedAt: state.reviewStageStartedAt,
    });
  } catch {
    // An assessment crash must never green-light the change — treat it
    // as a failed review attempt and let the ladder decide.
    return handleStageFailure(ctx);
  }

  if (!assessment.blocking) {
    // Success end-state: green review awaiting human sign-off. The
    // pipeline NEVER auto-approves — review → done stays human-gated by
    // the workflow engine.
    callbacks.onTrace?.(PIPELINE_REASONS.finished, state.handle.sessionId);
    return ctx.finish("succeeded", null);
  }

  if (assessment.unverifiable && assessment.blockingCount === 0) {
    // The review delivered nothing Arij can read, and NOTHING was recovered
    // from its prose either — so there is nothing for a fix agent to do.
    // Dispatching one anyway hands it "fix every [critical] and [major]
    // item" with an empty list, and it no-ops or invents changes to a
    // branch nothing faulted. This is a FAILED REVIEW ATTEMPT: the ladder
    // re-runs the review (a fresh session usually gets a working channel),
    // and exhausting it fails the run with a forensic, exactly like a
    // reviewer that crashed.
    //
    // The `blockingCount` half is not a detail. A broken channel does not
    // mean no evidence: assessReviewOutcome runs ingestProseFindings first,
    // and Arij parsed that report itself, independent of MCP. Those rows
    // carry agent_session_id NULL, so they never prove the channel worked —
    // the review stays unverifiable WITH a non-empty findings list. Sending
    // that to the ladder would discard real, anchored findings and re-ingest
    // the same report on every fresh review window, leaving duplicate open
    // rows nothing ever fixes. When there is something to fix, fix it: the
    // rows are open, so review → done still refuses, and the session still
    // has no verdict and no rows of its own, so the merge gate still calls
    // it not clean. Nothing becomes mergeable — the fix cycle just gets the
    // findings it was denied.
    return handleStageFailure(ctx);
  }

  if (state.fixCycles >= options.maxFixCycles) {
    // Nothing crashed — the open findings + trace are the diagnostic, so
    // no forensic here.
    callbacks.onTrace?.(
      PIPELINE_REASONS.failedFindings(state.fixCycles),
      state.handle.sessionId
    );
    return ctx.finish(
      "failed",
      `blocking findings remain after ${state.fixCycles} fix cycles`
    );
  }

  state.fixCycles += 1;
  return dispatchStage(ctx, {
    stage: "fix",
    attempt: 1,
    fixCycle: state.fixCycles,
    previousAttemptSessionId: null,
    lastCodeSessionId: state.lastCodeSessionId,
  });
}
