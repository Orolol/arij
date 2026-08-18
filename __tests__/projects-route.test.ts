import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbChain, state, mockSql, mockCount } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    leftJoin: vi.fn(),
    orderBy: vi.fn(),
    as: vi.fn(),
    all: vi.fn(),
  };

  const sharedState = {
    rows: [] as Array<Record<string, unknown>>,
  };

  const sqlExpression = () => ({
    as: vi.fn(() => ({})),
  });

  return {
    dbChain: chain,
    state: sharedState,
    mockSql: vi.fn(() => sqlExpression()),
    mockCount: vi.fn(() => sqlExpression()),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  sql: mockSql,
  count: mockCount,
}));

vi.mock("@/lib/db", () => ({
  db: dbChain,
}));

vi.mock("@/lib/db/schema", () => ({
  projects: {
    id: "id",
    name: "name",
    description: "description",
    status: "status",
    gitRepoPath: "gitRepoPath",
    githubOwnerRepo: "githubOwnerRepo",
    imported: "imported",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  epics: {
    id: "epics.id",
    projectId: "epics.projectId",
    status: "epics.status",
  },
  agentSessions: {
    id: "agent_sessions.id",
    projectId: "agent_sessions.projectId",
    status: "agent_sessions.status",
    createdAt: "agent_sessions.createdAt",
  },
}));

describe("GET /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = [];
    dbChain.select.mockReturnValue(dbChain);
    dbChain.from.mockReturnValue(dbChain);
    dbChain.where.mockReturnValue(dbChain);
    dbChain.groupBy.mockReturnValue(dbChain);
    dbChain.leftJoin.mockReturnValue(dbChain);
    dbChain.orderBy.mockReturnValue(dbChain);
    dbChain.as.mockReturnValue({});
    dbChain.all.mockImplementation(() => state.rows);
  });

  it("returns projects while building aggregate counts from JOIN subqueries", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    state.rows = [
      {
        id: "proj-1",
        name: "Project One",
        epicCount: 3,
        epicsDone: 1,
        epicsInProgress: 1,
        epicsReview: 1,
        epicsReleased: 0,
        activeAgents: 2,
        lastSessionAt: "2026-08-17T09:00:00Z",
      },
    ];

    const { GET } = await import("@/app/api/projects/route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual(state.rows);
    // epic counts + running agents + last session time
    expect(dbChain.leftJoin).toHaveBeenCalledTimes(3);
    expect(dbChain.groupBy).toHaveBeenCalledTimes(3);
    expect(mockCount).toHaveBeenCalledTimes(2);
    expect(debugSpy).toHaveBeenCalledWith(
      "[projects/GET] query profile",
      expect.objectContaining({
        rowCount: 1,
        queryMs: expect.any(Number),
      }),
    );
    debugSpy.mockRestore();
  });

  it("projects the dashboard aggregate columns the project cards need", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});

    const { GET } = await import("@/app/api/projects/route");
    await GET();

    const projections = dbChain.select.mock.calls.map(
      (call) => Object.keys((call[0] ?? {}) as Record<string, unknown>),
    );

    // Per-project status counts and the last session timestamp are what the
    // redesigned project card renders — they must be part of the payload.
    expect(
      projections.some((keys) =>
        ["epicsInProgress", "epicsReview", "epicsReleased"].every((key) =>
          keys.includes(key),
        ),
      ),
    ).toBe(true);
    expect(projections.some((keys) => keys.includes("lastSessionAt"))).toBe(true);

    // The outer row projection is the one joining every aggregate together.
    const rowProjection = projections.find(
      (keys) => keys.includes("activeAgents") && keys.includes("lastSessionAt"),
    );
    expect(rowProjection).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "epicCount",
        "epicsDone",
        "epicsInProgress",
        "epicsReview",
        "epicsReleased",
        "activeAgents",
        "lastSessionAt",
      ]),
    );
  });
});
