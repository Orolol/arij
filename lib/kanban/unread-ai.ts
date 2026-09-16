import { parseStoredTimestamp } from "@/lib/utils/timestamps";

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

export function hasUnreadAiComment(signal: UnreadAiSignal): boolean {
  if (!signal.latestCommentId) return false;
  if (!isAiCommentAuthor(signal.latestCommentAuthor)) return false;

  const commented = parseStoredTimestamp(signal.latestCommentCreatedAt ?? "");
  const read = parseStoredTimestamp(signal.lastReadAt ?? "");

  // Never read anything on this epic -> the AI comment is unread.
  if (read === null) return true;
  // A comment without a timestamp cannot be ordered against the cursor;
  // treat it as read rather than flag it forever.
  if (commented === null) return false;
  return commented > read;
}
