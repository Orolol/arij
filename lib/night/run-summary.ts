/**
 * The night run's morning-summary title.
 *
 * Only caller is the `night_run.completed` webhook payload
 * (lib/night/run.ts): the durable summary is the run's own rows and the
 * summary dialog, so this string is the one-line push for receivers outside
 * Arij.
 */
import { NIGHT_STOPPED_ABORT_REASON } from "@/lib/night/constants";
import type { TicketExecutionStatus } from "@/lib/dependencies/scheduler";

/**
 * Examples:
 *   "Night run finished: 5 to merge, 1 paused, 2 failed, 1 skipped — $4.20"
 *   "Night run finished: 3 to merge — ≥$1.10"
 *   "Night run finished: 2 failed, 4 skipped — circuit breaker tripped"
 *
 * Zero buckets are omitted; wave status "done" reads "to merge" (the night
 * run never merges; the passing review already promoted the ticket to To
 * Merge, awaiting the morning merge) and "asked" reads "paused". The cost
 * suffix appears only when > 0, prefixed "≥" when partial (non-Claude
 * providers report no cost). A breaker/cost-cap abort appends its marker.
 */
export function buildNightRunSummaryTitle(
  counts: Record<TicketExecutionStatus, number>,
  totalCostUsd: number,
  costIsPartial: boolean,
  abortReason: string | null
): string {
  const parts: string[] = [];
  if (counts.done > 0) parts.push(`${counts.done} to merge`);
  if (counts.asked > 0) parts.push(`${counts.asked} paused`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);

  let title =
    parts.length > 0
      ? `Night run finished: ${parts.join(", ")}`
      : "Night run finished";

  if (totalCostUsd > 0) {
    title += ` — ${costIsPartial ? "≥" : ""}$${totalCostUsd.toFixed(2)}`;
  }

  if (abortReason === NIGHT_STOPPED_ABORT_REASON) {
    title += " — stopped by you";
  } else if (abortReason?.startsWith("circuit breaker")) {
    title += " — circuit breaker tripped";
  } else if (abortReason?.startsWith("cost cap")) {
    title += " — cost cap reached";
  }

  return title;
}
