/**
 * Tests for Story 4: Automated Ticket Activity Integration.
 *
 * Validates that review comments are mirrored as ticket comments for
 * centralised activity history.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEpic = {
  id: "epic-1",
  title: "Test Epic",
  branchName: "feature/epic-abc",
  status: "review",
};

let insertCalls: { table: string; values: Record<string, unknown> }[] = [];

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn(function (this: typeof chain) {
      return this;
    }),
    orderBy: vi.fn(function (this: typeof chain) {
      return this;
    }),
    get: vi.fn(() => mockEpic),
    all: vi.fn(() => []),
    insert: vi.fn((table: { _name?: string }) => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        insertCalls.push({ table: table?._name ?? "unknown", values: vals });
        return { run: vi.fn() };
      }),
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ run: vi.fn() }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ run: vi.fn() }),
    }),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  reviewComments: {
    _name: "reviewComments",
    id: "id",
    epicId: "epicId",
    filePath: "filePath",
    lineNumber: "lineNumber",
    body: "body",
    author: "author",
    status: "status",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  epics: { _name: "epics", id: "id" },
  ticketComments: {
    _name: "ticketComments",
    id: "id",
    epicId: "epicId",
    author: "author",
    content: "content",
    createdAt: "createdAt",
  },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "new-id"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

describe("Ticket activity integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertCalls = [];
  });

  it("POST review comment also inserts a ticket comment for activity", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: "src/app.ts",
        lineNumber: 42,
        body: "Needs null check",
      }),
    });

    await POST(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    // Should have two insert calls: one for reviewComments, one for ticketComments
    const reviewInsert = insertCalls.find((c) => c.table === "reviewComments");
    const ticketInsert = insertCalls.find((c) => c.table === "ticketComments");

    expect(reviewInsert).toBeDefined();
    expect(ticketInsert).toBeDefined();
  });

  it("ticket comment content includes file path and line number", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: "lib/utils.ts",
        lineNumber: 99,
        body: "Extract this function",
      }),
    });

    await POST(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    const ticketInsert = insertCalls.find((c) => c.table === "ticketComments");
    expect(ticketInsert).toBeDefined();
    const content = ticketInsert!.values.content as string;
    expect(content).toContain("lib/utils.ts:99");
    expect(content).toContain("Extract this function");
    expect(content).toContain("Review comment");
  });

  it("ticket comment has author set to user", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: "src/app.ts",
        lineNumber: 10,
        body: "Fix this",
      }),
    });

    await POST(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    const ticketInsert = insertCalls.find((c) => c.table === "ticketComments");
    expect(ticketInsert!.values.author).toBe("user");
    expect(ticketInsert!.values.epicId).toBe("epic-1");
  });
});
