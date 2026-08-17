/**
 * Route tests for GET /api/agent-config/stats: `{ data }` envelope, optional
 * projectId scoping passthrough, and `{ error }` with 500 on failures.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockNextRequest } from "@/__tests__/helpers/db-mock";

const mockStats = vi.hoisted(() => ({
  getAgentReliabilityStats: vi.fn(),
  getReviewBounceStats: vi.fn(),
}));

vi.mock("@/lib/agent-config/stats", () => ({
  getAgentReliabilityStats: mockStats.getAgentReliabilityStats,
  getReviewBounceStats: mockStats.getReviewBounceStats,
}));

const { GET } = await import("@/app/api/agent-config/stats/route");

const AGENT_ROW = {
  agentName: "Fast",
  provider: "claude-code",
  runCount: 4,
  completedCount: 2,
  failedCount: 1,
  successRate: 2 / 3,
  medianDurationMs: 20000,
  totalCostUsd: 0.15,
};

const BOUNCE_ROW = {
  projectId: "proj-a",
  projectName: "Alpha",
  reviewedEpics: 2,
  bounceTransitions: 1,
  bounceRate: 0.5,
};

describe("GET /api/agent-config/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStats.getAgentReliabilityStats.mockReturnValue([AGENT_ROW]);
    mockStats.getReviewBounceStats.mockReturnValue([BOUNCE_ROW]);
  });

  it("returns { data: { agents, reviewBounce } } unscoped by default", async () => {
    const res = await GET(mockNextRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.agents).toEqual([AGENT_ROW]);
    expect(json.data.reviewBounce).toEqual([BOUNCE_ROW]);
    expect(mockStats.getAgentReliabilityStats).toHaveBeenCalledWith(undefined);
    expect(mockStats.getReviewBounceStats).toHaveBeenCalledWith(undefined);
  });

  it("passes the projectId query param through to both aggregations", async () => {
    const res = await GET(
      mockNextRequest({ searchParams: { projectId: "proj-a" } }),
    );

    expect(res.status).toBe(200);
    expect(mockStats.getAgentReliabilityStats).toHaveBeenCalledWith("proj-a");
    expect(mockStats.getReviewBounceStats).toHaveBeenCalledWith("proj-a");
  });

  it("treats a blank projectId as unscoped", async () => {
    await GET(mockNextRequest({ searchParams: { projectId: "  " } }));
    expect(mockStats.getAgentReliabilityStats).toHaveBeenCalledWith(undefined);
  });

  it("returns { error } with status 500 when aggregation fails", async () => {
    mockStats.getAgentReliabilityStats.mockImplementation(() => {
      throw new Error("no such table: agent_sessions");
    });

    const res = await GET(mockNextRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("no such table: agent_sessions");
  });
});
