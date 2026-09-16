import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import { mockNextRequest } from "@/__tests__/helpers/db-mock";
import {
  agentSessions,
  epics,
  ticketComments,
  ticketReadCursors,
  userStories,
} from "@/lib/db/schema";

// The inbox routes are pure Drizzle — run them against a real in-memory
// database built from the full migration chain (house pattern, see
// notifications-api.test.ts).
const testDb = vi.hoisted(() => ({
  instance: null as ReturnType<typeof import("@/lib/db/test-utils").createTestDb> | null,
}));

vi.mock("@/lib/db", async () =>
  (await import("@/__tests__/helpers/db-mock")).liveDbModule(testDb),
);

// ---- Import route handlers AFTER mocks ----
import { GET } from "@/app/api/inbox/route";
import { POST } from "@/app/api/inbox/read/route";

function db() {
  return testDb.instance!.db;
}

function seedEpic(
  id: string,
  projectId: string,
  overrides: Partial<typeof epics.$inferInsert> = {}
): void {
  db()
    .insert(epics)
    .values({
      id,
      projectId,
      title: `Epic ${id}`,
      status: "in_progress",
      readableId: `E-${projectId}-${id}`,
      ...overrides,
    })
    .run();
}

function seedComment(
  id: string,
  epicId: string,
  author: string,
  createdAt: string,
  content = `comment ${id}`
): void {
  db()
    .insert(ticketComments)
    .values({ id, epicId, author, content, createdAt })
    .run();
}

function seedSession(
  id: string,
  projectId: string,
  epicId: string,
  outcome: string | null,
  endedAt: string
): void {
  db()
    .insert(agentSessions)
    .values({
      id,
      projectId,
      epicId,
      status: "completed",
      outcome,
      endedAt,
      createdAt: endedAt,
    })
    .run();
}

function seedCursor(epicId: string, lastReadAt: string): void {
  db()
    .insert(ticketReadCursors)
    .values({ epicId, lastReadAt, updatedAt: lastReadAt })
    .run();
}

function readBody(epicId: unknown) {
  return mockNextRequest({
    url: "http://localhost/api/inbox/read",
    body: { epicId },
  });
}

beforeEach(() => {
  testDb.instance = createTestDb();
  testDb.instance.sqlite
    .prepare(
      "INSERT INTO projects (id, name) VALUES ('p1', 'Alpha'), ('p2', 'Beta')"
    )
    .run();
});

afterEach(() => { testDb.instance?.sqlite.close(); });

describe("GET /api/inbox", () => {
  it("clears a story question answered on its own thread, including finished tickets", async () => {
    seedEpic("e-story", "p1", { status: "done" });
    db().insert(userStories).values({ id: "story", epicId: "e-story", title: "Story", status: "done" }).run();
    db().insert(agentSessions).values({
      id: "story-question", projectId: "p1", epicId: "e-story", userStoryId: "story",
      status: "completed", outcome: "asked_question", createdAt: "2026-08-16T09:00:00Z",
      endedAt: "2026-08-16T09:00:00Z",
    }).run();
    seedComment("question", "e-story", "agent", "2026-08-16T09:00:00Z");
    seedCursor("e-story", "2026-08-16T10:00:00Z");
    const readInbox = async () => (await (await GET(new Request("http://localhost/api/inbox"))).json()).data;
    expect(await readInbox()).toMatchObject({ unreadCount: 1, unreadMessageCount: 0, awaitingReplyCount: 1 });

    // The story comments endpoint stores only userStoryId, without epicId.
    db().insert(ticketComments).values({
      id: "story-reply", userStoryId: "story", author: "user", content: "Use option A",
      createdAt: "2026-08-16 10:00:00",
    }).run();
    expect(await readInbox()).toMatchObject({ items: [], unreadCount: 0, unreadMessageCount: 0, awaitingReplyCount: 0 });
    const summary = await (await GET(new Request("http://localhost/api/inbox?summary=1"))).json();
    expect(summary.data).toMatchObject({ items: [], unreadCount: 0, awaitingReplyCount: 0 });
    // Answering a story does not mark the parent comment as read implicitly.
    db().delete(ticketReadCursors).run();
    expect(await readInbox()).toMatchObject({ unreadCount: 1, unreadMessageCount: 1, awaitingReplyCount: 0,
      items: [{ epicId: "e-story", unread: true, awaitingReply: false, latestCommentExcerpt: "comment question" }],
    });
  });

  it.each(["parent", "sibling"])("keeps a %s question pending when a different story completes", async (target) => {
    seedEpic("e-held", "p1", { status: "released" });
    db().insert(userStories).values([
      { id: "asked-story", epicId: "e-held", title: "Waiting story", status: "done" },
      { id: "finished-story", epicId: "e-held", title: "Other story", status: "done" },
    ]).run();
    db().insert(agentSessions).values([
      { id: "question", projectId: "p1", epicId: "e-held", userStoryId: target === "parent" ? null : "asked-story",
        status: "completed", outcome: "asked_question", createdAt: "2026-08-16T09:00:00Z" },
      { id: "success", projectId: "p1", epicId: "e-held", userStoryId: "finished-story",
        status: "completed", outcome: "success", createdAt: "2026-08-16 10:00:00" },
    ]).run();
    seedComment("report", "e-held", "agent", "2026-08-16T10:00:00Z", "Latest story report");
    seedCursor("e-held", "2026-08-16T11:00:00Z");
    const body = await (await GET(new Request("http://localhost/api/inbox?limit=1"))).json();
    expect(body.data).toMatchObject({ unreadCount: 1, unreadMessageCount: 0, awaitingReplyCount: 1,
      pagination: { page: 1, pageSize: 1, totalPages: 1 },
      items: [{ epicId: "e-held", awaitingReply: true, unread: false, latestCommentExcerpt: "Latest story report" }],
    });
  });

  it("counts several pending targets once and accepts a parent reply for all of them", async () => {
    seedEpic("e-many", "p1");
    db().insert(userStories).values([
      { id: "s1", epicId: "e-many", title: "First" },
      { id: "s2", epicId: "e-many", title: "Second" },
    ]).run();
    db().insert(agentSessions).values([null, "s1", "s2"].map((storyId, index) => ({
      id: `ask-${index}`, projectId: "p1", epicId: "e-many", userStoryId: storyId,
      status: "completed", outcome: "asked_question", createdAt: "2026-08-16T09:00:00Z",
    }))).run();
    const readInbox = async () => (await (await GET(new Request("http://localhost/api/inbox"))).json()).data;
    expect(await readInbox()).toMatchObject({ unreadCount: 1, awaitingReplyCount: 1 });
    db().insert(ticketComments).values({ id: "s1-reply", userStoryId: "s1", author: "user", content: "Answered",
      createdAt: "2026-08-16T10:00:00Z" }).run();
    // A reply on one story cannot answer the parent or the other story.
    expect(await readInbox()).toMatchObject({ unreadCount: 1, awaitingReplyCount: 1 });
    seedComment("parent-reply", "e-many", "user", "2026-08-16 11:00:00");
    expect(await readInbox()).toMatchObject({ items: [], unreadCount: 0, awaitingReplyCount: 0 });
  });

  it("chooses the latest comment and session by instant across stored formats", async () => {
    seedEpic("e-replied", "p1");
    seedComment("z-old", "e-replied", "agent", "2026-08-16T09:00:00Z");
    seedComment("a-new", "e-replied", "user", "2026-08-16 10:00:00");
    seedSession("z-question", "p1", "e-replied", "asked_question", "2026-08-16T09:00:00Z");
    seedSession("a-success", "p1", "e-replied", "success", "2026-08-16 10:00:00");
    seedEpic("e-question", "p1");
    seedComment("z-user", "e-question", "user", "2026-08-16T09:00:00Z");
    seedComment("a-agent", "e-question", "agent", "2026-08-16 10:00:00");
    seedSession("z-success", "p1", "e-question", "success", "2026-08-16T09:00:00Z");
    seedSession("a-question", "p1", "e-question", "asked_question", "2026-08-16 10:00:00");
    const body = await (await GET(new Request("http://localhost/api/inbox"))).json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ epicId: "e-question", awaitingReply: true, latestCommentExcerpt: "comment a-agent" });
  });

  it("recognizes later replies even when an earlier ISO reply sorts after them as text", async () => {
    seedEpic("e1", "p1");
    seedSession("s1", "p1", "e1", "asked_question", "2026-08-16T10:00:00Z");
    seedComment("u-old", "e1", "user", "2026-08-16T09:00:00Z");
    seedComment("u-new", "e1", "user", "2026-08-16 11:00:00");
    const body = await (await GET(new Request("http://localhost/api/inbox"))).json();
    expect(body.data.items).toEqual([]);
  });

  it("orders timezone offsets and resolves equivalent latest instants by id", async () => {
    seedEpic("e1", "p1");
    seedEpic("e2", "p1");
    seedComment("c1", "e1", "agent", "2026-08-16T12:00:00+02:00");
    seedComment("a2", "e2", "user", "2026-08-16T11:00:00Z");
    seedComment("z2", "e2", "agent", "2026-08-16 11:00:00");
    const body = await (await GET(new Request("http://localhost/api/inbox"))).json();
    expect(body.data.items.map((item: { epicId: string }) => item.epicId)).toEqual(["e2", "e1"]);
  });

  it("returns an empty inbox for an empty database", async () => {
    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.data.unreadCount).toBe(0);
    expect(body.data.unreadMessageCount).toBe(0);
    expect(body.data.awaitingReplyCount).toBe(0);
  });

  /*
   * B-arij-DWd1DEARyLMe — the inbox shipped ONE counter (`unreadCount`, the
   * row count) and the page printed it as "N waiting", so 55 unread reports
   * on finished tickets read as 55 blocked agents. The row count stays: it is
   * the global bar badge's rule and the ticket freezes it. What was missing is
   * the split — how many of those rows are unread messages, and how many are
   * questions actually waiting on the user.
   */
  it("counts unread messages and pending questions in separate counters", async () => {
    // A finished ticket whose report was never opened: unread, no question.
    seedEpic("e-report", "p1", { status: "done" });
    seedComment("c1", "e-report", "agent", "2026-08-16T09:00:00.000Z");
    // A real question the user has already opened but not answered: awaiting,
    // and NOT unread.
    seedEpic("e-question", "p1");
    seedComment("c2", "e-question", "agent", "2026-08-16T08:00:00.000Z");
    seedSession(
      "s1",
      "p1",
      "e-question",
      "asked_question",
      "2026-08-16T08:00:00.000Z"
    );
    seedCursor("e-question", "2026-08-16T08:30:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    // Unchanged rule — the bar badge counts every row in the inbox.
    expect(body.data.unreadCount).toBe(2);
    // The split the page needs, each counting only its own category.
    expect(body.data.unreadMessageCount).toBe(1);
    expect(body.data.awaitingReplyCount).toBe(1);
  });

  it("counts an unread question in both counters without doubling the row", async () => {
    seedEpic("e1", "p1");
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");
    seedSession("s1", "p1", "e1", "asked_question", "2026-08-16T09:00:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.items).toHaveLength(1);
    expect(body.data.unreadCount).toBe(1);
    expect(body.data.unreadMessageCount).toBe(1);
    expect(body.data.awaitingReplyCount).toBe(1);
  });

  it("leaves the awaiting counter at zero when every row is a plain report", async () => {
    seedEpic("e1", "p1", { status: "done" });
    seedEpic("e2", "p1", { status: "done" });
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");
    seedComment("c2", "e2", "agent", "2026-08-16T10:00:00.000Z");
    // Terminal sessions that delivered — no question anywhere.
    seedSession("s1", "p1", "e1", "success", "2026-08-16T09:00:00.000Z");
    seedSession("s2", "p1", "e2", "success", "2026-08-16T10:00:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.unreadCount).toBe(2);
    expect(body.data.unreadMessageCount).toBe(2);
    expect(body.data.awaitingReplyCount).toBe(0);
  });

  it("collects unread agent comments across ALL projects with project names", async () => {
    seedEpic("e1", "p1");
    seedEpic("e2", "p2");
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");
    seedComment("c2", "e2", "agent", "2026-08-16T10:00:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.unreadCount).toBe(2);
    expect(body.data.items).toHaveLength(2);
    const byEpic = Object.fromEntries(
      body.data.items.map((i: { epicId: string }) => [i.epicId, i])
    );
    expect(byEpic.e1).toMatchObject({
      projectId: "p1",
      projectName: "Alpha",
      readableId: "E-p1-e1",
      title: "Epic e1",
      status: "in_progress",
      unread: true,
      awaitingReply: false,
      latestCommentAuthor: "agent",
      latestCommentExcerpt: "comment c1",
      latestCommentCreatedAt: "2026-08-16T09:00:00.000Z",
      lastReadAt: null,
    });
    expect(byEpic.e2.projectName).toBe("Beta");
  });

  it("excludes epics whose latest comment is user-authored", async () => {
    seedEpic("e1", "p1");
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");
    seedComment("c2", "e1", "user", "2026-08-16T10:00:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.items).toEqual([]);
  });

  it("excludes epics whose cursor is newer than the latest agent comment", async () => {
    seedEpic("e1", "p1");
    seedEpic("e2", "p1");
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");
    seedComment("c2", "e2", "agent", "2026-08-16T09:00:00.000Z");
    seedCursor("e1", "2026-08-16T10:00:00.000Z"); // read after the comment
    seedCursor("e2", "2026-08-16T08:00:00.000Z"); // read before the comment

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.items.map((i: { epicId: string }) => i.epicId)).toEqual([
      "e2",
    ]);
    expect(body.data.items[0].lastReadAt).toBe("2026-08-16T08:00:00.000Z");
  });

  it("keeps awaiting-reply epics in the inbox even when already read", async () => {
    seedEpic("e1", "p1");
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");
    seedSession("s1", "p1", "e1", "asked_question", "2026-08-16T09:00:00.000Z");
    // The user opened the ticket (cursor newer than the comment) but never
    // replied — the question is still pending.
    seedCursor("e1", "2026-08-16T10:00:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      epicId: "e1",
      awaitingReply: true,
      unread: false,
    });
  });

  it("drops the awaiting flag once the user replies after the question", async () => {
    seedEpic("e1", "p1");
    seedSession("s1", "p1", "e1", "asked_question", "2026-08-16T09:00:00.000Z");
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");
    seedComment("c2", "e1", "user", "2026-08-16T09:30:00.000Z");
    seedCursor("e1", "2026-08-16T10:00:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    // Replied AND read -> gone from the inbox entirely.
    expect(body.data.items).toEqual([]);
  });

  it("orders awaiting-reply first, then newest comment first", async () => {
    // Non-awaiting unread comments, one newer than the awaiting one.
    seedEpic("e-old-unread", "p1");
    seedComment("c1", "e-old-unread", "agent", "2026-08-16T08:00:00.000Z");
    seedEpic("e-new-unread", "p2");
    seedComment("c2", "e-new-unread", "agent", "2026-08-16T12:00:00.000Z");
    // Awaiting-reply epic with an OLDER comment than both.
    seedEpic("e-awaiting", "p1");
    seedComment("c3", "e-awaiting", "agent", "2026-08-16T06:00:00.000Z");
    seedSession(
      "s1",
      "p1",
      "e-awaiting",
      "asked_question",
      "2026-08-16T06:00:00.000Z"
    );

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.items.map((i: { epicId: string }) => i.epicId)).toEqual([
      "e-awaiting",
      "e-new-unread",
      "e-old-unread",
    ]);
  });

  it("only the LATEST session's verdict drives the awaiting flag", async () => {
    seedEpic("e1", "p1");
    seedSession("s1", "p1", "e1", "asked_question", "2026-08-16T09:00:00.000Z");
    seedSession("s2", "p1", "e1", "answered", "2026-08-16T11:00:00.000Z");
    seedComment("c1", "e1", "user", "2026-08-16T11:30:00.000Z");

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.items).toEqual([]);
  });

  it("flattens whitespace and truncates long comments in the excerpt", async () => {
    seedEpic("e1", "p1");
    const content = `line one\nline two    with\tspaces ${"x".repeat(300)}`;
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z", content);

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    const excerpt = body.data.items[0].latestCommentExcerpt as string;
    expect(excerpt.startsWith("line one line two with spaces")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("orders SQLite-format comment timestamps against ISO cursors", async () => {
    // ticket_comments.created_at DEFAULT CURRENT_TIMESTAMP writes
    // "YYYY-MM-DD HH:MM:SS"; cursors are always ISO. The comparison must
    // stay chronological across the two formats.
    seedEpic("e1", "p1");
    seedEpic("e2", "p1");
    seedComment("c1", "e1", "agent", "2026-08-16 09:00:00");
    seedComment("c2", "e2", "agent", "2026-08-16 09:00:00");
    seedCursor("e1", "2026-08-16T08:00:00.000Z"); // before -> unread
    seedCursor("e2", "2026-08-16T10:00:00.000Z"); // after -> read

    const res = await GET(new Request("http://localhost/api/inbox"));
    const body = await res.json();

    expect(body.data.items.map((i: { epicId: string }) => i.epicId)).toEqual([
      "e1",
    ]);
  });
});

describe("POST /api/inbox/read", () => {
  it("creates the cursor row for the epic", async () => {
    const before = new Date().toISOString();
    const res = await POST(readBody("e1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.ok).toBe(true);
    expect(body.data.epicId).toBe("e1");

    const rows = db().select().from(ticketReadCursors).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].epicId).toBe("e1");
    expect(rows[0].lastReadAt >= before).toBe(true);
  });

  it("upserts: moves an existing cursor forward without duplicating rows", async () => {
    seedCursor("e1", "2020-01-01T00:00:00.000Z");

    await POST(readBody("e1"));

    const rows = db().select().from(ticketReadCursors).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].lastReadAt > "2020-01-01T00:00:00.000Z").toBe(true);
    expect(rows[0].updatedAt).toBe(rows[0].lastReadAt);
  });

  it("rejects a missing epicId with 400", async () => {
    const res = await POST(readBody(undefined));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
  });

  it("removes a read epic from the inbox and drops the unread count", async () => {
    seedEpic("e1", "p1");
    seedComment("c1", "e1", "agent", "2026-08-16T09:00:00.000Z");

    let body = await (await GET(new Request("http://localhost/api/inbox"))).json();
    expect(body.data.unreadCount).toBe(1);

    await POST(readBody("e1"));

    body = await (await GET(new Request("http://localhost/api/inbox"))).json();
    expect(body.data.items).toEqual([]);
    expect(body.data.unreadCount).toBe(0);
  });
});


describe("inbox pagination", () => {
  it("pages a stable queue while keeping global counts and unanswered questions", async () => {
    for (let index = 0; index < 7; index++) {
      seedEpic(`page-${index}`, index % 2 ? "p1" : "p2");
      seedComment(`comment-${index}`, `page-${index}`, "agent", "2026-08-16T10:00:00Z", "long report ".repeat(1000));
    }
    seedSession("question", "p2", "page-6", "asked_question", "2026-08-16T10:00:00Z");
    seedCursor("page-6", "2026-08-16T11:00:00Z");
    const pages = [];
    for (let page = 1; page <= 3; page++) {
      const body = await (await GET(new Request(`http://localhost/api/inbox?limit=3&page=${page}`))).json();
      expect(body.data).toMatchObject({ unreadCount: 7, unreadMessageCount: 6, awaitingReplyCount: 1,
        pagination: { page, pageSize: 3, totalPages: 3 } });
      pages.push(body.data.items);
    }
    expect(pages[0][0]).toMatchObject({ epicId: "page-6", awaitingReply: true, unread: false });
    const ids = pages.flat().map((item) => item.epicId);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(pages.flat().every((item) => item.latestCommentExcerpt.length <= 200)).toBe(true);
    const summary = await (await GET(new Request("http://localhost/api/inbox?summary=1"))).json();
    expect(summary.data).toMatchObject({ items: [], unreadCount: 7, unreadMessageCount: 6, awaitingReplyCount: 1 });
  });

  it("clamps a page that disappeared after messages were read", async () => {
    seedEpic("remaining", "p1");
    seedComment("last", "remaining", "agent", "2026-08-16T10:00:00Z");
    const body = await (await GET(new Request("http://localhost/api/inbox?page=8"))).json();
    expect(body.data.pagination).toMatchObject({ page: 1, totalPages: 1 });
    expect(body.data.items[0].epicId).toBe("remaining");
  });

  it.each(["page=0", "page=-1", "page=1.5", "page=no", "limit=0", "limit=101"])("rejects invalid pagination %s", async (query) => {
    expect((await GET(new Request(`http://localhost/api/inbox?${query}`))).status).toBe(400);
  });
});
