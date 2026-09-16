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
        activeAgents: 2,
      },
    ];

    const { GET } = await import("@/app/api/projects/route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual(state.rows);
    // ONE aggregate survives: the running-agent count the TopBar reads.
    expect(dbChain.leftJoin).toHaveBeenCalledTimes(1);
    expect(dbChain.groupBy).toHaveBeenCalledTimes(1);
    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      "[projects/GET] query profile",
      expect.objectContaining({
        rowCount: 1,
        queryMs: expect.any(Number),
      }),
    );
    debugSpy.mockRestore();
  });

  it("projects ONLY the live-agent aggregate the project chips read", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});

    const { GET } = await import("@/app/api/projects/route");
    await GET();

    const projections = dbChain.select.mock.calls.map(
      (call) => Object.keys((call[0] ?? {}) as Record<string, unknown>),
    );

    // The five per-status epic counts and the last-session stamp belonged to
    // the retired dashboard cards; only `activeAgents` has a consumer.
    const rowProjection = projections.find(
      (keys) => keys.includes("activeAgents") && keys.includes("id"),
    );
    expect(rowProjection).toEqual(
      expect.arrayContaining(["id", "name", "activeAgents"]),
    );
    const flat = projections.flat();
    for (const retired of [
      "epicCount",
      "epicsDone",
      "epicsInProgress",
      "epicsReview",
      "epicsReleased",
      "lastSessionAt",
    ]) {
      expect(flat).not.toContain(retired);
    }
  });
});
