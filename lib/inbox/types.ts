export const INBOX_PAGE_SIZE = 50;

/** Shared contract of GET /api/inbox and its consumers. */
export interface InboxItem {
  epicId: string;
  projectId: string;
  projectName: string;
  readableId: string | null;
  title: string;
  status: string | null;
  type: string | null;
  awaitingReply: boolean;
  unread: boolean;
  latestCommentAuthor: string | null;
  latestCommentExcerpt: string | null;
  latestCommentCreatedAt: string | null;
  lastReadAt: string | null;
}

export interface InboxData {
  items: InboxItem[];
  pagination: { page: number; pageSize: number; totalPages: number };
  /** Every row, including questions already read but still unanswered. */
  unreadCount: number;
  unreadMessageCount: number;
  awaitingReplyCount: number;
}
