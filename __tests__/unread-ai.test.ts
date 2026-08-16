import { describe, expect, it } from "vitest";
import { hasUnreadAiComment, isAiCommentAuthor } from "@/lib/kanban/unread-ai";

describe("isAiCommentAuthor", () => {
  it("treats anything that is not the user as AI/system origin", () => {
    expect(isAiCommentAuthor("agent")).toBe(true);
    expect(isAiCommentAuthor("system")).toBe(true);
    expect(isAiCommentAuthor("status")).toBe(true);
  });

  it("rejects the user (case-insensitive) and empty authors", () => {
    expect(isAiCommentAuthor("user")).toBe(false);
    expect(isAiCommentAuthor("User")).toBe(false);
    expect(isAiCommentAuthor(null)).toBe(false);
    expect(isAiCommentAuthor(undefined)).toBe(false);
    expect(isAiCommentAuthor("")).toBe(false);
  });
});

describe("hasUnreadAiComment", () => {
  const base = {
    latestCommentId: "c1",
    latestCommentAuthor: "agent",
    latestCommentCreatedAt: "2026-08-16T10:00:00.000Z",
  };

  it("is unread when there is an agent comment and no cursor", () => {
    expect(hasUnreadAiComment({ ...base, lastReadAt: null })).toBe(true);
    expect(hasUnreadAiComment(base)).toBe(true);
  });

  it("is not unread when there is no comment at all", () => {
    expect(
      hasUnreadAiComment({
        latestCommentId: null,
        latestCommentAuthor: null,
        latestCommentCreatedAt: null,
        lastReadAt: null,
      })
    ).toBe(false);
  });

  it("is not unread when the latest comment is user-authored", () => {
    expect(
      hasUnreadAiComment({ ...base, latestCommentAuthor: "user" })
    ).toBe(false);
  });

  it("compares the comment against the read cursor", () => {
    expect(
      hasUnreadAiComment({ ...base, lastReadAt: "2026-08-16T09:00:00.000Z" })
    ).toBe(true);
    expect(
      hasUnreadAiComment({ ...base, lastReadAt: "2026-08-16T11:00:00.000Z" })
    ).toBe(false);
    // Cursor exactly at the comment time counts as read.
    expect(
      hasUnreadAiComment({ ...base, lastReadAt: base.latestCommentCreatedAt })
    ).toBe(false);
  });

  it("orders SQLite CURRENT_TIMESTAMP comments against ISO cursors", () => {
    // "2026-08-16 10:00:00" (SQLite, space separator) vs ISO cursors.
    const sqliteComment = {
      ...base,
      latestCommentCreatedAt: "2026-08-16 10:00:00",
    };
    expect(
      hasUnreadAiComment({
        ...sqliteComment,
        lastReadAt: "2026-08-16T09:00:00.000Z",
      })
    ).toBe(true);
    expect(
      hasUnreadAiComment({
        ...sqliteComment,
        lastReadAt: "2026-08-16T11:00:00.000Z",
      })
    ).toBe(false);
  });

  it("treats an untimestamped comment as read once any cursor exists", () => {
    expect(
      hasUnreadAiComment({
        ...base,
        latestCommentCreatedAt: null,
        lastReadAt: "2026-08-16T09:00:00.000Z",
      })
    ).toBe(false);
    expect(
      hasUnreadAiComment({ ...base, latestCommentCreatedAt: null })
    ).toBe(true);
  });
});
