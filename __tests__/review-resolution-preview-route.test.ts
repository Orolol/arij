/**
 * Tests for GET /api/projects/[projectId]/review-resolution — the preview
 * endpoint the review dispatch dialog uses to show which provider a review
 * would resolve to (review provider segregation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const resolveAgentForDispatch = vi.hoisted(() =>
  vi.fn(async () => ({
    provider: "gemini-cli",
    namedAgentId: null,
    segregated: true,
    builderProvider: "claude-code",
  }))
);

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentForDispatch,
}));

async function loadRoute() {
  return import("@/app/api/projects/[projectId]/review-resolution/route");
}

describe("GET /api/projects/[projectId]/review-resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("returns 404 when the project does not exist", async () => {
    dbMockState.getQueue.push(null); // project lookup

    const { GET } = await loadRoute();
    const res = await GET(
      mockNextRequest({ searchParams: { agentType: "review_feature" } }),
      mockRouteContext({ projectId: "missing" })
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 for an invalid agentType", async () => {
    dbMockState.getQueue.push({ id: "proj-1", name: "Test" }); // project

    const { GET } = await loadRoute();
    const res = await GET(
      mockNextRequest({ searchParams: { agentType: "nonsense" } }),
      mockRouteContext({ projectId: "proj-1" })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid agentType");
  });

  it("returns the resolution in the { data } envelope and threads the review context", async () => {
    dbMockState.getQueue.push({ id: "proj-1", name: "Test" });

    const { GET } = await loadRoute();
    const res = await GET(
      mockNextRequest({
        searchParams: {
          agentType: "review_feature",
          epicId: "epic-1",
          storyId: "us-1",
        },
      }),
      mockRouteContext({ projectId: "proj-1" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      provider: "gemini-cli",
      namedAgentId: null,
      name: null,
      segregated: true,
      builderProvider: "claude-code",
    });

    expect(resolveAgentForDispatch).toHaveBeenCalledWith(
      "review_feature",
      "proj-1",
      null,
      {
        purpose: "review",
        projectId: "proj-1",
        epicId: "epic-1",
        storyId: "us-1",
      }
    );
  });

  it("passes an explicit namedAgentId through and reports no segregation", async () => {
    dbMockState.getQueue.push({ id: "proj-1", name: "Test" });
    resolveAgentForDispatch.mockResolvedValueOnce({
      provider: "claude-code",
      namedAgentId: "named-1",
      name: "CC Opus",
    } as never);

    const { GET } = await loadRoute();
    const res = await GET(
      mockNextRequest({
        searchParams: {
          agentType: "review_code",
          epicId: "epic-1",
          namedAgentId: "named-1",
        },
      }),
      mockRouteContext({ projectId: "proj-1" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.segregated).toBe(false);
    expect(body.data.builderProvider).toBeNull();
    expect(body.data.namedAgentId).toBe("named-1");
    expect(resolveAgentForDispatch).toHaveBeenCalledWith(
      "review_code",
      "proj-1",
      "named-1",
      expect.objectContaining({ purpose: "review", epicId: "epic-1" })
    );
  });
});
