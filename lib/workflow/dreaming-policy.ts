/** Pure dispatch and output decisions, shared by manual and night-run dreams. */
import { NIGHT_STOPPED_ABORT_REASON } from "@/lib/night/constants";

export interface DreamDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Pure guard matrix — exported for exhaustive testing.
 *
 * Denials, in evaluation order:
 *   - a memory writer is already queued/running for the project. Both a dream
 *     and a distill replace the WHOLE document, so either one in flight blocks
 *     this dream — two concurrent rewrites would race, last-write-wins;
 *   - the window turned up nothing new (the silent, journalled no-op: paying
 *     for a dream that would re-derive the memory it already has is waste).
 */
export function evaluateDreamGuards(input: {
  hasPendingMemoryWriter: boolean;
  sessionCount: number;
}): DreamDecision {
  if (input.hasPendingMemoryWriter) {
    return {
      allowed: false,
      reason:
        "a memory rewrite (distill or dream) is already pending for this project",
    };
  }
  if (input.sessionCount <= 0) {
    return {
      allowed: false,
      reason: "no new sessions since the last dream",
    };
  }
  return { allowed: true, reason: "eligible" };
}

/**
 * Pure guard matrix for the night-run trigger — exported for testing.
 *
 * The dream is dispatched from the run's terminal choke point, which is AFTER
 * the wave engine's last cost-cap check. The cap therefore cannot stop the
 * dream on its own, so it is re-evaluated here: a run that already spent its
 * budget does not get to spend more on a dream just because the dream comes
 * last. Same reasoning for an explicit user stop — "stop this run" plainly
 * means "stop spending on it".
 *
 * A circuit-breaker abort is deliberately NOT a denial: a run that failed its
 * way to a breaker trip is exactly the run whose lessons are worth distilling.
 */
export function evaluateNightRunDreamGuards(input: {
  enabled: boolean;
  abortReason: string | null;
  costCapUsd: number | null;
  spentUsd: number;
}): DreamDecision {
  if (!input.enabled) {
    return { allowed: false, reason: "dreaming_after_night_run is off" };
  }
  if (input.abortReason === NIGHT_STOPPED_ABORT_REASON) {
    return { allowed: false, reason: "night run was stopped by the user" };
  }
  if (input.costCapUsd !== null && input.spentUsd >= input.costCapUsd) {
    return {
      allowed: false,
      reason: `night run cost cap reached ($${input.spentUsd.toFixed(2)} of $${input.costCapUsd.toFixed(2)})`,
    };
  }
  return { allowed: true, reason: "eligible" };
}

/**
 * Strips an accidental full-document code fence from the agent's output
 * (the prompt forbids fences, but a cheap unwrap beats a corrupted doc).
 */
export function sanitizeDreamedMemory(output: string): string {
  const trimmed = output.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*)\n```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

