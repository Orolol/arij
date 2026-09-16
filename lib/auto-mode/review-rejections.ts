import { and, eq, inArray } from "drizzle-orm";
import type { ArijDatabase } from "@/lib/db";
import { ticketActivityLog } from "@/lib/db/schema";
import { parseStoredTimestamp } from "@/lib/utils/timestamps";

/** Human replies reset the budget for repeated review → build loops. */
export function readReviewRejections(
  db: ArijDatabase,
  epicIds: string[],
  lastUserCommentByEpic: ReadonlyMap<string, string | null>,
) {
  const reviewRejectionRows = epicIds.length
    ? db.select({
        epicId: ticketActivityLog.epicId,
        createdAt: ticketActivityLog.createdAt,
      }).from(ticketActivityLog).where(and(
        inArray(ticketActivityLog.epicId, epicIds),
        eq(ticketActivityLog.fromStatus, "review"),
        eq(ticketActivityLog.toStatus, "in_progress"),
      )).all()
    : [];
  const reviewRejectionsByEpic = new Map<string, number>();
  const lastReviewRejectionAtByEpic = new Map<string, string>();
  for (const row of reviewRejectionRows) {
    if (!row.epicId || !row.createdAt) continue;
    const atMs = parseStoredTimestamp(row.createdAt);
    if (atMs === null) continue;
    const at = new Date(atMs).toISOString();
    const resetAt = lastUserCommentByEpic.get(row.epicId);
    if (resetAt && atMs <= (parseStoredTimestamp(resetAt) ?? -Infinity)) continue;
    reviewRejectionsByEpic.set(
      row.epicId,
      (reviewRejectionsByEpic.get(row.epicId) ?? 0) + 1
    );
    const previous = lastReviewRejectionAtByEpic.get(row.epicId);
    if (!previous || at > previous) {
      lastReviewRejectionAtByEpic.set(row.epicId, at);
    }
  }

  return { reviewRejectionsByEpic, lastReviewRejectionAtByEpic };
}
