/**
 * Integration tests for the Stats-tab aggregates (lib/agent-config/stats):
 * real migrated DB via createTestDb, aggregation entirely in SQL —
 * run counts, success rate, odd/even medians, NULL-preserving cost sums,
 * per-project review bounce, and projectId scoping.
 */
import { describe, expect, it, vi, beforeAll } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const { agentSessions, epics, projects, ticketActivityLog } = await import(
  "@/lib/db/schema"
);
const { getAgentReliabilityStats, getReviewBounceStats } = await import(
  "@/lib/agent-config/stats"
);

const T0 = "2026-08-16T10:00:00.000Z";
function plusSeconds(seconds: number): string {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

let seq = 0;
function insertSession(values: {
  projectId: string;
  status: string;
  provider?: string | null;
  namedAgentName?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  totalCostUsd?: number | null;
}): void {
  db.insert(agentSessions)
    .values({
      id: `sess-${++seq}`,
      projectId: values.projectId,
      status: values.status,
      provider: values.provider ?? "claude-code",
      namedAgentName: values.namedAgentName ?? null,
      startedAt: values.startedAt ?? null,
      endedAt: values.endedAt ?? null,
      totalCostUsd: values.totalCostUsd ?? null,
      createdAt: T0,
    })
    .run();
}

function insertTransition(values: {
  projectId: string;
  epicId: string;
  fromStatus: string;
  toStatus: string;
}): void {
  db.insert(ticketActivityLog)
    .values({
      id: `act-${++seq}`,
      projectId: values.projectId,
      epicId: values.epicId,
      fromStatus: values.fromStatus,
      toStatus: values.toStatus,
      actor: "agent",
      createdAt: T0,
    })
    .run();
}

beforeAll(() => {
  db.insert(projects)
    .values([
      { id: "proj-a", name: "Alpha" },
      { id: "proj-b", name: "Beta" },
    ])
    .run();
  db.insert(epics)
    .values([
      { id: "epic-1", projectId: "proj-a", title: "E1", status: "done" },
      { id: "epic-2", projectId: "proj-a", title: "E2", status: "review" },
    ])
    .run();

  // Named agent "Fast" (claude-code) in proj-a:
  // 2 completed (10s @ $0.05, 20s @ $0.10), 1 failed (40s, no cost),
  // 1 still running — median over terminal runs = 20s.
  insertSession({
    projectId: "proj-a",
    status: "completed",
    namedAgentName: "Fast",
    startedAt: T0,
    endedAt: plusSeconds(10),
    totalCostUsd: 0.05,
  });
  insertSession({
    projectId: "proj-a",
    status: "completed",
    namedAgentName: "Fast",
    startedAt: T0,
    endedAt: plusSeconds(20),
    totalCostUsd: 0.1,
  });
  insertSession({
    projectId: "proj-a",
    status: "failed",
    namedAgentName: "Fast",
    startedAt: T0,
    endedAt: plusSeconds(40),
  });
  insertSession({
    projectId: "proj-a",
    status: "running",
    namedAgentName: "Fast",
    startedAt: T0,
  });

  // Named agent "Even" (claude-code) in proj-a: even count -> averaged median.
  insertSession({
    projectId: "proj-a",
    status: "completed",
    namedAgentName: "Even",
    startedAt: T0,
    endedAt: plusSeconds(10),
  });
  insertSession({
    projectId: "proj-a",
    status: "completed",
    namedAgentName: "Even",
    startedAt: T0,
    endedAt: plusSeconds(20),
  });

  // Unnamed codex session in proj-b: no cost reported anywhere.
  insertSession({
    projectId: "proj-b",
    status: "completed",
    provider: "codex",
    startedAt: T0,
    endedAt: plusSeconds(30),
  });

  // Review flow in proj-a: epic-1 bounces once then passes; epic-2 reaches
  // review without bouncing. proj-b has no review activity at all.
  insertTransition({
    projectId: "proj-a",
    epicId: "epic-1",
    fromStatus: "in_progress",
    toStatus: "review",
  });
  insertTransition({
    projectId: "proj-a",
    epicId: "epic-1",
    fromStatus: "review",
    toStatus: "in_progress",
  });
  insertTransition({
    projectId: "proj-a",
    epicId: "epic-1",
    fromStatus: "in_progress",
    toStatus: "review",
  });
  insertTransition({
    projectId: "proj-a",
    epicId: "epic-1",
    fromStatus: "review",
    toStatus: "done",
  });
  insertTransition({
    projectId: "proj-a",
    epicId: "epic-2",
    fromStatus: "in_progress",
    toStatus: "review",
  });
});

describe("getAgentReliabilityStats", () => {
  it("aggregates run counts, success rate, median duration and cost per agent x provider", () => {
    const rows = getAgentReliabilityStats();
    expect(rows).toHaveLength(3);

    const fast = rows.find((r) => r.agentName === "Fast");
    expect(fast).toMatchObject({
      provider: "claude-code",
      runCount: 4,
      completedCount: 2,
      failedCount: 1,
      medianDurationMs: 20000,
    });
    expect(fast!.successRate).toBeCloseTo(2 / 3, 5);
    expect(fast!.totalCostUsd).toBeCloseTo(0.15, 5);
  });

  it("averages the two middle durations for even terminal counts", () => {
    const even = getAgentReliabilityStats().find(
      (r) => r.agentName === "Even",
    );
    expect(even).toMatchObject({
      runCount: 2,
      completedCount: 2,
      failedCount: 0,
      successRate: 1,
      medianDurationMs: 15000,
    });
  });

  it("keeps cost NULL (never zero) for agents that reported no cost", () => {
    const codex = getAgentReliabilityStats().find(
      (r) => r.provider === "codex",
    );
    expect(codex).toMatchObject({
      agentName: null,
      runCount: 1,
      totalCostUsd: null,
      medianDurationMs: 30000,
    });
  });

  it("sorts by run count and scopes to a project when asked", () => {
    const all = getAgentReliabilityStats();
    expect(all.map((r) => r.runCount)).toEqual([4, 2, 1]);

    const scoped = getAgentReliabilityStats("proj-a");
    expect(scoped).toHaveLength(2);
    expect(scoped.map((r) => r.agentName).sort()).toEqual(["Even", "Fast"]);

    expect(getAgentReliabilityStats("proj-none")).toEqual([]);
  });
});

describe("getReviewBounceStats", () => {
  it("computes bounce transitions over distinct reviewed epics per project", () => {
    const rows = getReviewBounceStats();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: "proj-a",
      projectName: "Alpha",
      reviewedEpics: 2,
      bounceTransitions: 1,
    });
    expect(rows[0].bounceRate).toBeCloseTo(0.5, 5);
  });

  it("scopes to a project and returns nothing for review-free projects", () => {
    const scoped = getReviewBounceStats("proj-a");
    expect(scoped).toHaveLength(1);
    expect(scoped[0].projectId).toBe("proj-a");

    expect(getReviewBounceStats("proj-b")).toEqual([]);
  });
});
