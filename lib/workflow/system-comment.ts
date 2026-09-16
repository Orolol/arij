/**
 * A system-originated comment on a ticket.
 *
 * The inbox (ticket_comments + `ticket_read_cursors`) is the app's one
 * signalling surface after the notifications table was removed, so the
 * project-level signals that used to write a notification row and DID affect
 * a ticket — a failing CI watch, a locally-ready autofix — land here, where
 * the epic's unread dot and the cross-project inbox pick them up.
 *
 * `author: "agent"` on purpose: `lib/kanban/unread-ai.ts` treats anything that
 * is not the human as AI/system-origin, which is what makes the row visible.
 * The caller supplies the whole body; this module owns only the row shape.
 */
import { db } from "@/lib/db";
import { ticketComments } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";

export function postTicketSystemComment(input: {
  epicId: string;
  content: string;
  /** The session that produced the signal, when there is one. */
  sessionId?: string | null;
}): void {
  db.insert(ticketComments)
    .values({
      id: createId(),
      epicId: input.epicId,
      author: "agent",
      content: input.content,
      agentSessionId: input.sessionId ?? null,
      createdAt: new Date().toISOString(),
    })
    .run();
}

/**
 * Tell the ticket that a launch prompt cited documents Docs does not hold.
 *
 * The run still starts — an agent writing `@some/file.ts` about the project's
 * own codebase must never block a build or a review, and a user typo should
 * cost a comment, not a refused launch. Before the notifications table was
 * removed this was a notification row; the ticket is the surface that renders
 * it now, and the comment says which mentions resolved to nothing.
 */
export function postUnresolvedMentionsComment(input: {
  epicId: string;
  missing: readonly string[] | undefined;
  agentType: string | null;
}): void {
  if (!input.missing || input.missing.length === 0) return;

  const mentions = input.missing.map((name) => `@${name}`).join(", ");
  const role = input.agentType ?? "agent";
  postTicketSystemComment({
    epicId: input.epicId,
    content: `**Unresolved document mention(s) in this ${role} prompt:** ${mentions}.\n\nThe run started without them — upload the files in Docs or remove the mentions from the launch prompt.`,
  });
}
