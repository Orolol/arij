import type { PipelineStageHandle, PipelineStageResult } from "./runner";
import type { PipelineRunContext } from "./runner-context";

/**
 * Cancellation policy of the runner.
 *
 * Awaits a stage settle with the cancel watch: when the session row turns
 * 'cancelled' before the closure settles (queued session removed from the
 * scheduler by the user's stop), a synthesized failure settles the wait.
 * First resolution wins; the post-settle status re-read in the main loop
 * keeps the race benign (both paths see the cancelled row).
 */
export function awaitStageSettled(
  ctx: PipelineRunContext,
  current: PipelineStageHandle
): Promise<PipelineStageResult> {
  const sessionId = current.sessionId;
  if (!sessionId) return current.settled;

  return new Promise<PipelineStageResult>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (result: PipelineStageResult): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    current.settled.then(settle, (error: unknown) =>
      // Settled promises never reject by contract — belt and braces.
      settle({
        sessionId,
        success: false,
        outcome: null,
        error:
          error instanceof Error ? error.message : "Stage settled rejected",
      })
    );

    const tick = (): void => {
      if (done) return;
      if (ctx.readStatusSafe(sessionId) === "cancelled") {
        settle({
          sessionId,
          success: false,
          outcome: null,
          error: "Cancelled by user",
        });
        return;
      }
      timer = setTimeout(tick, ctx.pollMs);
    };
    timer = setTimeout(tick, ctx.pollMs);
  });
}
