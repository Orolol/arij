import { parseStoredTimestamp } from "@/lib/utils/timestamps";

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

export function isAwaitingReply(signal: AwaitingReplySignal): boolean {
  if (signal.latestSessionOutcome !== "asked_question") return false;

  const asked = parseStoredTimestamp(signal.latestSessionEndedAt ?? "");
  const replied = parseStoredTimestamp(signal.latestUserCommentCreatedAt ?? "");

  // No user comment at all -> the question is definitely unanswered.
  if (replied === null) return true;
  // Cannot order the reply against the question -> assume it answered.
  if (asked === null) return false;
  return replied <= asked;
}
