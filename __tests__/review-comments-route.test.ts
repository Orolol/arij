/**
 * Tests for the review comments CRUD API route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEpic = {
  id: "epic-1",
  title: "Test Epic",
  branchName: "feature/epic-abc",
  status: "review",
};

const mockComment = {
  id: "rc-1",
  epicId: "epic-1",
  filePath: "src/app.ts",
  lineNumber: 42,
  body: "This needs a null check",
  author: "user",
  status: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let storedComments: typeof mockComment[] = [];

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
    all: vi.fn(() => storedComments),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ run: vi.fn() }),
    }),
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
  epics: { id: "id" },
  ticketComments: {
    id: "id",
    epicId: "epicId",
    author: "author",
    content: "content",
    createdAt: "createdAt",
  },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "new-comment-id"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

describe("review-comments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedComments = [mockComment];
  });

  it("GET returns all comments for an epic", async () => {
    const { GET } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = new Request("http://localhost/api/projects/p1/epics/epic-1/review-comments");
    const res = await GET(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual(storedComments);
  });

  it("POST validates required fields", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "src/app.ts" }), // missing lineNumber and body
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("required");
  });

  it("POST creates a comment with correct fields", async () => {
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

    const res = await POST(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    expect(res.status).toBe(201);
  });

  it("PATCH validates id is required", async () => {
    const { PATCH } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = new Request("http://localhost/api/test", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });

    const res = await PATCH(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    expect(res.status).toBe(400);
  });

  it("DELETE validates id is required", async () => {
    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = new Request("http://localhost/api/test", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await DELETE(req as never, {
      params: Promise.resolve({ projectId: "p1", epicId: "epic-1" }),
    });

    expect(res.status).toBe(400);
  });
});
