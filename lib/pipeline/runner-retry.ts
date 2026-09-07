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
 * launcher can resume it or descend one rank of a composite), or exhaust into
 * the forensic diagnostic and the terminal failure.
 *
 * The ladder's length is `state.stageMaxAttempts`, sized at stage entry — the
 * configured cap for a simple agent, the member count for a composite — not
 * `options.maxAttempts`, which only bounds the former.
 *
 * `descentReason` is the previous attempt's verdict, forwarded so a composite
 * rank-down entry can say what the descent was FOR.
 */
export async function handleStageFailure(
  ctx: PipelineRunContext,
  descentReason?: string
): Promise<PipelineTerminalSummary | null> {
  const { options, callbacks, state } = ctx;

  // The hard session ceiling cuts the ladder as well as the forensic
  // dispatch. Without this a composite longer than the sessions a run has
  // left would keep asking for members it can never spend.
  const sessionsLeft = state.sessionIds.length < options.maxSessions;
  if (state.stageAttempt < state.stageMaxAttempts && sessionsLeft) {
    const nextAttempt = state.stageAttempt + 1;
    callbacks.onTrace?.(
      PIPELINE_REASONS.retry(state.stage, nextAttempt, state.stageMaxAttempts),
      state.handle.sessionId
    );
    const currentRequest = state.currentRequest;
    return dispatchStage(ctx, {
      stage: state.stage,
      attempt: nextAttempt,
      fixCycle: state.fixCycles,
      previousAttemptSessionId: state.handle.sessionId,
      lastCodeSessionId: state.lastCodeSessionId,
      ...(descentReason ? { descentReason } : {}),
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
  const reason =
    state.stageAttempt < state.stageMaxAttempts
      ? `stage ${failedStage} failed after ${attempts} attempts (session ceiling reached)`
      : `stage ${failedStage} failed after ${attempts} attempts`;
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
