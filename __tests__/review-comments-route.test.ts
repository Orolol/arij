/**
 * Tests for the review comments CRUD API route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDbChainMock,
  resetDbMockState,
  mockJsonRequest,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

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

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps. get()/all() are pinned in
// beforeEach to reproduce the previous always-return-mockEpic behavior.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "new-comment-id"),
}));

describe("review-comments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    storedComments = [mockComment];
    const chain = getDbChainMock();
    chain.get.mockReturnValue(mockEpic);
    chain.all.mockImplementation(() => storedComments);
  });

  it("GET returns all comments for an epic", async () => {
    const { GET } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = mockNextRequest({
      url: "http://localhost/api/projects/p1/epics/epic-1/review-comments",
    });
    const res = await GET(req, mockRouteContext({ projectId: "p1", epicId: "epic-1" }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual(storedComments);
  });

  it("POST validates required fields", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    // missing lineNumber and body
    const req = mockJsonRequest({ filePath: "src/app.ts" });

    const res = await POST(req, mockRouteContext({ projectId: "p1", epicId: "epic-1" }));

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("required");
  });

  it("POST creates a comment with correct fields", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = mockJsonRequest({
      filePath: "src/app.ts",
      lineNumber: 42,
      body: "Needs null check",
    });

    const res = await POST(req, mockRouteContext({ projectId: "p1", epicId: "epic-1" }));

    expect(res.status).toBe(201);
  });

  it("PATCH validates id is required", async () => {
    const { PATCH } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = mockNextRequest({ method: "PATCH", body: { status: "resolved" } });

    const res = await PATCH(req, mockRouteContext({ projectId: "p1", epicId: "epic-1" }));

    expect(res.status).toBe(400);
  });

  it("DELETE validates id is required", async () => {
    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/review-comments/route"
    );

    const req = mockNextRequest({ method: "DELETE", body: {} });

    const res = await DELETE(req, mockRouteContext({ projectId: "p1", epicId: "epic-1" }));

    expect(res.status).toBe(400);
  });
});
