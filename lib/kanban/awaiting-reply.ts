/**
 * "Awaiting reply" signal for kanban cards.
 *
 * An epic is awaiting the user's reply when its latest agent session ended
 * with the `asked_question` delivery verdict and the user has not commented
 * since that session ended. A newer user comment counts as the reply; a
 * newer session (running or re-classified) replaces the verdict upstream in
 * the query, so it never reaches this check as `asked_question`.
 */

export interface AwaitingReplySignal {
  /** Delivery verdict of the epic's latest agent session (any status). */
  latestSessionOutcome?: string | null;
  /** When that session ended (ISO-8601 / SQLite UTC timestamp). */
  latestSessionEndedAt?: string | null;
  /** Creation time of the epic's latest user-authored comment. */
  latestUserCommentCreatedAt?: string | null;
}

/**
 * Timestamps mix ISO-8601 (`2026-08-16T09:00:00.000Z`, written by routes)
 * and SQLite CURRENT_TIMESTAMP (`2026-08-16 09:00:00`, both UTC). Normalizing
 * the separator makes lexicographic comparison chronologically correct.
 */
function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.includes("T") ? value : value.replace(" ", "T");
}

export function isAwaitingReply(signal: AwaitingReplySignal): boolean {
  if (signal.latestSessionOutcome !== "asked_question") return false;

  const asked = normalizeTimestamp(signal.latestSessionEndedAt);
  const replied = normalizeTimestamp(signal.latestUserCommentCreatedAt);

  // No user comment at all -> the question is definitely unanswered.
  if (!replied) return true;
  // Cannot order the reply against the question -> assume it answered.
  if (!asked) return false;
  return replied <= asked;
}
