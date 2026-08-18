import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";

const testDb = vi.hoisted(() => ({
  instance: null as ReturnType<
    typeof import("@/lib/db/test-utils").createTestDb
  > | null,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.db;
  },
  get sqlite() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.sqlite;
  },
}));

// The filesystem scan is stubbed out: this test must never touch the user's
// real ~/.codex/sessions tree, and must certainly never spawn a codex process.
vi.mock("@/lib/usage/codex-snapshot", () => ({
  refreshCodexUsageSnapshot: vi.fn(),
}));

// ---- Import route handler AFTER mocks ----
import { GET } from "@/app/api/usage/route";
import { refreshCodexUsageSnapshot } from "@/lib/usage/codex-snapshot";

const refreshMock = vi.mocked(refreshCodexUsageSnapshot);

function seedSession(id: string, overrides: Record<string, unknown> = {}): void {
  testDb
    .instance!.sqlite.prepare(
      `INSERT INTO agent_sessions (
         id, project_id, status, provider, named_agent_name,
         input_tokens, output_tokens, total_cost_usd, ended_at, created_at
       ) VALUES (
         @id, @projectId, @status, @provider, @namedAgentName,
         @inputTokens, @outputTokens, @totalCostUsd, @endedAt, @createdAt
       )`,
    )
    .run({
      id,
      projectId: "p1",
      status: "completed",
      provider: "claude-code",
      namedAgentName: "Builder",
      inputTokens: 100,
      outputTokens: 10,
      totalCostUsd: 1.25,
      endedAt: new Date(Date.now() - 60_000).toISOString(),
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      ...overrides,
    });
}

beforeEach(() => {
  testDb.instance = createTestDb();
  testDb.instance.sqlite
    .prepare("INSERT INTO projects (id, name) VALUES ('p1', 'Project One')")
    .run();
  refreshMock.mockReset();
  refreshMock.mockImplementation(() => {});
});

describe("GET /api/usage", () => {
  it("returns the report inside the { data } envelope", async () => {
    seedSession("s1");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.data).toBeDefined();
    expect(body.data.totals).toEqual({
      sessions: 1,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 1.25,
    });
  });

  it("refreshes the codex snapshot before reading (refresh-on-read seam)", async () => {
    await GET();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("serves every section of the contract in one response", async () => {
    seedSession("s1");

    const { data } = await (await GET()).json();

    expect(Object.keys(data).sort()).toEqual([
      "byAgent",
      "byDay",
      "byProject",
      "byProvider",
      "generatedAt",
      "subscriptions",
      "totals",
      "windows",
    ]);
    expect(data.byDay).toHaveLength(30);
    expect(data.byAgent[0].name).toBe("Builder");
    expect(data.byProject[0].projectName).toBe("Project One");
    expect(data.windows.last5h.sessions).toBe(1);
    expect(data.windows.last7d.sessions).toBe(1);
    expect(typeof data.generatedAt).toBe("string");
  });

  it("always ships the claude card labelled as metered, never provider-reported", async () => {
    const { data } = await (await GET()).json();
    const claude = data.subscriptions.find(
      (s: { provider: string }) => s.provider === "claude-code",
    );
    expect(claude.source).toBe("metered-via-arij");
    expect(claude.capturedAt).toBeNull();
    expect(claude.metered).not.toBeNull();
  });

  it("responds on an empty database without inventing numbers", async () => {
    const { data } = await (await GET()).json();
    expect(data.totals.sessions).toBe(0);
    expect(data.totals.costUsd).toBeNull();
    expect(data.byAgent).toEqual([]);
  });

  it("returns the { error } envelope with a 500 when the read blows up", async () => {
    refreshMock.mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("boom");
    expect(body.data).toBeUndefined();
  });
});
