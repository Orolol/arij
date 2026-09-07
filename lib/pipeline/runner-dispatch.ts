import type { PipelineState } from "./constants";
import { PIPELINE_REASONS } from "./constants";
import type {
  PipelineGuardCheck,
  PipelineStageKind,
  PipelineStageRequest,
  PipelineTerminalSummary,
} from "./runner";
import { sizeStageBudget, type PipelineRunContext } from "./runner-context";

/**
 * Pre-dispatch guards and the stage dispatch itself.
 *
 * Three guards run before every stage: (a) the hard session cap
 * (PIPELINE_MAX_SESSIONS_PER_RUN), (b) the target-conflict probe — another
 * agent took the ticket between stages — and (c) the review-status guard for
 * the observational stages. Then the stage's attempt budget is sized (entry
 * only), the launcher is called, and the first-attempt / composite rank-down
 * traces are written.
 */

const RUNNING_STATE_BY_STAGE: Record<PipelineStageKind, PipelineState> = {
  build: "running_build",
  grading: "running_grading",
  review: "running_review",
  fix: "running_fix",
};

/**
 * Guards + dispatches one stage. Returns null when the stage is in flight
 * (`state.handle` updated), or the terminal summary when a guard tripped.
 */
export async function dispatchStage(
  ctx: PipelineRunContext,
  request: PipelineStageRequest
): Promise<PipelineTerminalSummary | null> {
  const { options, callbacks, state } = ctx;

  // Guard (a): hard session cap.
  if (state.sessionIds.length >= options.maxSessions) {
    callbacks.onTrace?.(PIPELINE_REASONS.failedSessionCap, null);
    return ctx.finish("failed", "session cap reached");
  }

  // Guard (b): another agent took the ticket between stages.
  let guard: PipelineGuardCheck;
  try {
    guard = options.checkGuards([...state.sessionIds]);
  } catch {
    guard = { conflictSessionId: null, reviewTargetStatus: null };
  }
  if (guard.conflictSessionId) {
    callbacks.onTrace?.(
      PIPELINE_REASONS.failedTargetBusy,
      guard.conflictSessionId
    );
    return ctx.finish("failed", "target busy: another agent took the ticket");
  }

  // Guard (c): observational grading and review both require the delivered
  // target to still sit in review|done.
  if (
    (request.stage === "grading" || request.stage === "review") &&
    guard.reviewTargetStatus !== "review" &&
    guard.reviewTargetStatus !== "done"
  ) {
    callbacks.onTrace?.(PIPELINE_REASONS.failedTicketNotInReview, null);
    return ctx.finish("failed", "ticket left review before the review stage");
  }

  state.stage = request.stage;
  state.stageAttempt = request.attempt;
  state.currentRequest = request;

  // Stage ENTRY, not every attempt: the ladder a run is already climbing
  // must not resize under it.
  if (request.attempt === 1) {
    await sizeStageBudget(ctx, request.stage);
  }

  callbacks.onStageChange?.(
    RUNNING_STATE_BY_STAGE[request.stage],
    request.stage,
    request.attempt,
    state.fixCycles
  );

  if (request.stage === "review") {
    // Findings window: everything the reviewer files lands at or after
    // this instant (submit_findings writes explicit ISO timestamps).
    state.reviewStageStartedAt = new Date().toISOString();
  }

  try {
    state.handle = await options.launchStage(request);
  } catch (error) {
    state.handle = {
      sessionId: null,
      settled: Promise.resolve({
        sessionId: "",
        success: false,
        outcome: null,
        error:
          error instanceof Error ? error.message : "Stage dispatch failed",
      }),
      compositeDescent: null,
    };
  }
  const handle = state.handle;

  if (handle.sessionId) {
    state.sessionIds.push(handle.sessionId);
    callbacks.onSessionAdded?.(handle.sessionId, request.stage);
  }

  // First attempts announce the stage; retries were announced by the
  // retry trace at the failure decision.
  if (request.attempt === 1) {
    if (request.stage === "review") {
      callbacks.onTrace?.(PIPELINE_REASONS.reviewStarted, handle.sessionId);
    } else if (request.stage === "grading") {
      // A rubric-free dispatch writes its own explicit skip journal entry.
      if (handle.sessionId) {
        callbacks.onTrace?.(
          PIPELINE_REASONS.gradingStarted,
          handle.sessionId
        );
      }
    } else if (request.stage === "fix") {
      callbacks.onTrace?.(
        PIPELINE_REASONS.fixStarted(request.fixCycle, options.maxFixCycles),
        handle.sessionId
      );
    }
  }

  if (handle.compositeDescent) {
    callbacks.onTrace?.(
      PIPELINE_REASONS.compositeRankDown(
        request.stage,
        handle.compositeDescent.from,
        handle.compositeDescent.to,
        request.descentReason ?? "failed",
        request.attempt,
        state.stageMaxAttempts
      ),
      handle.sessionId
    );
  }

  return null;
}
