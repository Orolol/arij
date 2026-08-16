/**
 * "Unread AI comment" signal, shared by the kanban Board dot and the
 * cross-project inbox (`/api/inbox`).
 *
 * Source of truth: the per-epic read cursor (`ticket_read_cursors`,
 * migration 0025). An epic has an unread AI comment when its latest
 * comment is agent-authored and was created after the epic's cursor
 * (no cursor row means nothing was ever read).
 */

export interface UnreadAiSignal {
  /** Id of the epic's latest comment (any author). */
  latestCommentId?: string | null;
  /** Author of that comment (`user` | `agent` | system-ish variants). */
  latestCommentAuthor?: string | null;
  /** Creation time of that comment (ISO-8601 or SQLite UTC timestamp). */
  latestCommentCreatedAt?: string | null;
  /** The epic's read cursor (`ticket_read_cursors.last_read_at`), if any. */
  lastReadAt?: string | null;
}

/** Anything that is not the human user counts as AI/system-origin. */
export function isAiCommentAuthor(author: string | null | undefined): boolean {
  if (!author) return false;
  return author.toLowerCase() !== "user";
}

/**
 * Timestamps mix ISO-8601 (`2026-08-16T09:00:00.000Z`, written by routes)
 * and SQLite CURRENT_TIMESTAMP (`2026-08-16 09:00:00`, both UTC). Normalizing
 * the separator makes lexicographic comparison chronologically correct.
 * (Same normalization as lib/kanban/awaiting-reply.ts.)
 */
function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.includes("T") ? value : value.replace(" ", "T");
}

export function hasUnreadAiComment(signal: UnreadAiSignal): boolean {
  if (!signal.latestCommentId) return false;
  if (!isAiCommentAuthor(signal.latestCommentAuthor)) return false;

  const commented = normalizeTimestamp(signal.latestCommentCreatedAt);
  const read = normalizeTimestamp(signal.lastReadAt);

  // Never read anything on this epic -> the AI comment is unread.
  if (!read) return true;
  // A comment without a timestamp cannot be ordered against the cursor;
  // treat it as read rather than flag it forever.
  if (!commented) return false;
  return commented > read;
}
