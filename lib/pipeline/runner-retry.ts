import { PIPELINE_REASONS } from "./constants";
import type { PipelineTerminalSummary } from "./runner";
import { awaitStageSettled } from "./runner-cancel-watch";
import type { PipelineRunContext } from "./runner-context";
import { dispatchStage } from "./runner-dispatch";

/**
 * Retry ladder and forensic post-mortem.
 *
 * Failure path for the current stage: climb the retry ladder (the next
 * attempt of the same stage, carrying the failed attempt's session so the
 * launcher can resume or escalate), or exhaust into the forensic diagnostic
 * and the terminal failure.
 */
export async function handleStageFailure(
  ctx: PipelineRunContext
): Promise<PipelineTerminalSummary | null> {
  const { options, callbacks, state } = ctx;

  if (state.stageAttempt < options.maxAttempts) {
    const nextAttempt = state.stageAttempt + 1;
    callbacks.onTrace?.(
      PIPELINE_REASONS.retry(state.stage, nextAttempt, options.maxAttempts),
      state.handle.sessionId
    );
    const currentRequest = state.currentRequest;
    return dispatchStage(ctx, {
      stage: state.stage,
      attempt: nextAttempt,
      fixCycle: state.fixCycles,
      previousAttemptSessionId: state.handle.sessionId,
      lastCodeSessionId: state.lastCodeSessionId,
      ...(currentRequest?.verifyFailure
        ? { verifyFailure: currentRequest.verifyFailure }
        : {}),
      ...(currentRequest?.gradingFailure
        ? { gradingFailure: currentRequest.gradingFailure }
        : {}),
      ...(currentRequest?.verificationFailure
        ? { verificationFailure: currentRequest.verificationFailure }
        : {}),
      ...(currentRequest?.verificationReport
        ? { verificationReport: currentRequest.verificationReport }
        : {}),
    });
  }

  // Ladder exhausted — post-mortem, then terminal failure. The terminal
  // reason is always the stage failure; the forensic run is best-effort
  // diagnostics and never changes how the run ends (nor does the session
  // cap blocking its dispatch).
  const failedStage = state.stage;
  const attempts = state.stageAttempt;
  const reason = `stage ${failedStage} failed after ${attempts} attempts`;
  callbacks.onTrace?.(
    PIPELINE_REASONS.failedStage(failedStage, attempts),
    state.handle.sessionId
  );

  const deadSessionId = state.handle.sessionId;
  if (deadSessionId && state.sessionIds.length < options.maxSessions) {
    callbacks.onStageChange?.(
      "running_forensic",
      "forensic",
      1,
      state.fixCycles
    );
    try {
      const forensic = await options.runForensic({
        deadSessionId,
        stage: failedStage,
        attempts,
      });
      if (forensic.sessionId) {
        state.sessionIds.push(forensic.sessionId);
        callbacks.onSessionAdded?.(forensic.sessionId, "forensic");
      }
      // Any result (success, failure, refusal) → the run still fails.
      // Awaited through the cancel watch: a forensic session stopped while
      // still QUEUED is removed from the scheduler without its closure ever
      // running, so its settled promise would hang this engine forever.
      await awaitStageSettled(ctx, {
        sessionId: forensic.sessionId,
        settled: forensic.settled,
      });
    } catch (error) {
      console.warn(
        "[pipeline] Forensic dispatch failed:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return ctx.finish("failed", reason);
}
