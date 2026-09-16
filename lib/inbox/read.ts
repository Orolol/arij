import { readEpicActivityFacts, readEpicComments } from "@/lib/control-desk/read-model";
import type { ArijDatabase } from "@/lib/db";
import {
  epics,
  projects,
  ticketComments,
  ticketReadCursors
} from "@/lib/db/schema";
import type { InboxData, InboxItem } from "@/lib/inbox/types";
import { hasUnreadAiComment } from "@/lib/kanban/unread-ai";
import { parseStoredTimestamp } from "@/lib/utils/timestamps";
import { eq, inArray, sql } from "drizzle-orm";

/** Max length of the comment excerpt shipped to the inbox UI. */
const EXCERPT_LENGTH = 200;

function excerptOf(content: string | null): string | null {
  if (!content) return null;
  const flattened = content.replace(/\s+/g, " ").trim();
  if (flattened.length <= EXCERPT_LENGTH) return flattened;
  return `${flattened.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

/**
 * GET /api/inbox — cross-project inbox of unread agent messages.
 *
 * An epic is in the inbox when:
 *  - its latest comment is agent-authored and newer than the epic's read
 *    cursor (`ticket_read_cursors`, no row = never read), OR
 *  - the latest session on the parent or any of its stories ended with
 *    `asked_question` and that target has not received a reply. Parent replies
 *    also answer story questions. Reading alone does not answer a question.
 *
 * Order: awaiting-reply first, then newest comment first.
 *
 * THE TWO CATEGORIES ARE COUNTED APART (B-arij-DWd1DEARyLMe). Most rows are
 * unread reports on tickets that are already finished; only the awaiting-reply
 * ones are a question actually held on the user. The response therefore
 * carries three numbers:
 *  - `unreadCount` — every row. UNCHANGED: this is the rule the global bar
 *    badge has always counted, and the ticket freezes it.
 *  - `unreadMessageCount` — rows whose latest agent message has not been read.
 *  - `awaitingReplyCount` — rows holding a real pending question.
 * A row can be in both categories (an unread question); it is still one row,
 * so the two never have to add up to `unreadCount`.
 */
export function readInboxPage(
  db: ArijDatabase,
  requestedPage: number,
  pageSize: number,
  summaryOnly = false,
): InboxData {
  const baseRows = db
    .select({
      epicId: epics.id,
      projectId: epics.projectId,
      projectName: projects.name,
      readableId: epics.readableId,
      title: epics.title,
      status: epics.status,
      type: epics.type,
      lastReadAt: ticketReadCursors.lastReadAt,
    })
    .from(epics)
    .innerJoin(projects, eq(epics.projectId, projects.id))
    .leftJoin(ticketReadCursors, eq(epics.id, ticketReadCursors.epicId))
    .all();

  const latestComments = readEpicComments(db, baseRows.map((row) => row.epicId), 0);
  const rows = baseRows.map((row) => {
    const comment = latestComments.get(row.epicId);
    return { ...row, latestCommentId: comment?.id ?? null, latestCommentAuthor: comment?.author ?? null, latestCommentCreatedAt: comment?.createdAt ?? null };
  });

  const facts = readEpicActivityFacts(db, rows.map((row) => row.epicId), [...new Set(rows.map((row) => row.projectId))]);

  const candidates = rows
    .map((row) => ({
      row,
      unread: hasUnreadAiComment(row),
      awaitingReply: facts.awaitingReplyByEpic.get(row.epicId) ?? false,
    }))
    .filter(({ unread, awaitingReply }) => unread || awaitingReply)
    .sort((a, b) => {
      if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1;
      // Newest comment first within each group.
      return (parseStoredTimestamp(b.row.latestCommentCreatedAt ?? "") ?? 0)
        - (parseStoredTimestamp(a.row.latestCommentCreatedAt ?? "") ?? 0)
        || a.row.epicId.localeCompare(b.row.epicId);
    });
  const totalPages = Math.max(1, Math.ceil(candidates.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const selected = summaryOnly ? [] : candidates.slice((page - 1) * pageSize, page * pageSize);
  const commentIds = selected.flatMap(({ row }) => row.latestCommentId ? [row.latestCommentId] : []);
  // Only the visible page needs bodies. The global badge asks for metadata
  // alone, and historical comments never cross the DB boundary here.
  const comments = commentIds.length
    ? db.select({
        id: ticketComments.id,
        content: sql<string | null>`substr(${ticketComments.content}, 1, 4096)`,
      }).from(ticketComments).where(inArray(ticketComments.id, commentIds)).all()
    : [];
  const contentById = new Map(comments.map((comment) => [comment.id, comment.content]));
  const items: InboxItem[] = selected.map(({ row, unread, awaitingReply }) => ({
    epicId: row.epicId,
    projectId: row.projectId,
    projectName: row.projectName,
    readableId: row.readableId,
    title: row.title,
    status: row.status,
    type: row.type,
    awaitingReply,
    unread,
    latestCommentAuthor: row.latestCommentAuthor,
    latestCommentExcerpt: excerptOf(row.latestCommentId ? contentById.get(row.latestCommentId) ?? null : null),
    latestCommentCreatedAt: row.latestCommentCreatedAt,
    lastReadAt: row.lastReadAt,
  }));

  return {
    items,
    unreadCount: candidates.length,
    unreadMessageCount: candidates.filter((item) => item.unread).length,
    awaitingReplyCount: candidates.filter((item) => item.awaitingReply).length,
    pagination: { page, pageSize, totalPages },
  };
}
