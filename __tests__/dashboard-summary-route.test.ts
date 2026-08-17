import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import { agentSessions, epics, projects } from "@/lib/db/schema";

// Pure Drizzle route — real in-memory database from the full migration chain.
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

import { GET } from "@/app/api/dashboard/summary/route";

interface SummaryBody {
  data: {
    runningSessions: Array<{
      sessionId: string;
      projectId: string;
      projectName: string | null;
      epicId: string | null;
      epicReadableId: string | null;
      provider: string | null;
      agentType: string | null;
      startedAt: string | null;
    }>;
    nightRunsLastNight: { projects: number; totalCostUsd: number };
    yesterday: { completed: number; failed: number };
  };
}

function db() {
  return testDb.instance!.db;
}

/** UTC "YYYY-MM-DD HH:MM:SS", exactly what sqlite CURRENT_TIMESTAMP writes. */
function sqliteStamp(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace("T", " ");
}

/** ISO with a `T` and a zone, exactly what the session lifecycle writes. */
function isoStamp(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function seedProject(id: string, name: string): void {
  db().insert(projects).values({ id, name }).run();
}

function seedEpic(id: string, projectId: string, readableId: string): void {
  db()
    .insert(epics)
    .values({ id, projectId, title: `Epic ${id}`, readableId })
    .run();
}

function seedSession(
  id: string,
  projectId: string,
  values: Partial<typeof agentSessions.$inferInsert> = {}
): void {
  db()
    .insert(agentSessions)
    .values({
      id,
      projectId,
      status: "completed",
      createdAt: sqliteStamp(3600_000),
      ...values,
    })
    .run();
}

async function callRoute(): Promise<SummaryBody["data"]> {
  const res = await GET();
  const body = (await res.json()) as SummaryBody;
  return body.data;
}

describe("GET /api/dashboard/summary", () => {
  beforeEach(() => {
    testDb.instance = createTestDb();
    seedProject("p1", "Arij");
    seedProject("p2", "Astra");
  });

  it("returns honest zeros on an empty database", async () => {
    const data = await callRoute();

    expect(data.runningSessions).toEqual([]);
    expect(data.nightRunsLastNight).toEqual({ projects: 0, totalCostUsd: 0 });
    expect(data.yesterday).toEqual({ completed: 0, failed: 0 });
  });

  it("lists running sessions with their project and epic identity", async () => {
    seedEpic("e1", "p1", "E-arij-093");
    seedSession("s1", "p1", {
      status: "running",
      epicId: "e1",
      provider: "claude-code",
      agentType: "build",
      startedAt: isoStamp(60_000),
      createdAt: sqliteStamp(60_000),
    });
    seedSession("s2", "p1", { status: "queued" });
    seedSession("s3", "p1", { status: "completed" });

    const data = await callRoute();

    expect(data.runningSessions).toHaveLength(1);
    expect(data.runningSessions[0]).toMatchObject({
      sessionId: "s1",
      projectId: "p1",
      projectName: "Arij",
      epicId: "e1",
      epicReadableId: "E-arij-093",
      provider: "claude-code",
      agentType: "build",
    });
  });

  it("keeps running sessions that have no epic attached", async () => {
    seedSession("s1", "p1", { status: "running", epicId: null });

    const data = await callRoute();

    expect(data.runningSessions).toHaveLength(1);
    expect(data.runningSessions[0].epicId).toBeNull();
    expect(data.runningSessions[0].epicReadableId).toBeNull();
  });

  it("counts distinct projects and summed cost for last night's runs", async () => {
    seedSession("s1", "p1", {
      batchRunId: "night_a41c",
      totalCostUsd: 4.2,
      createdAt: sqliteStamp(6 * 3600_000),
    });
    seedSession("s2", "p1", {
      batchRunId: "night_a41c",
      totalCostUsd: 1.0,
      createdAt: sqliteStamp(5 * 3600_000),
    });
    seedSession("s3", "p2", {
      batchRunId: "night_b77e",
      totalCostUsd: 0.9,
      createdAt: sqliteStamp(4 * 3600_000),
    });
    // A daytime batch is not a night run.
    seedSession("s4", "p2", {
      batchRunId: "batch_1234",
      totalCostUsd: 9.99,
      createdAt: sqliteStamp(3600_000),
    });
    // Last week's night run is outside the window.
    seedSession("s5", "p2", {
      batchRunId: "night_old",
      totalCostUsd: 50,
      createdAt: sqliteStamp(8 * 86_400_000),
    });

    const data = await callRoute();

    expect(data.nightRunsLastNight.projects).toBe(2);
    expect(data.nightRunsLastNight.totalCostUsd).toBeCloseTo(6.1, 5);
  });

  it("counts terminal sessions from the last 24h as yesterday", async () => {
    seedSession("s1", "p1", { status: "completed", endedAt: isoStamp(3600_000) });
    seedSession("s2", "p1", { status: "completed", endedAt: isoStamp(7200_000) });
    seedSession("s3", "p2", { status: "failed", endedAt: isoStamp(1800_000) });
    seedSession("s4", "p2", { status: "running", endedAt: null });
    seedSession("s5", "p2", { status: "cancelled", endedAt: isoStamp(600_000) });
    seedSession("s6", "p1", {
      status: "completed",
      endedAt: isoStamp(3 * 86_400_000),
      createdAt: sqliteStamp(3 * 86_400_000),
    });

    const data = await callRoute();

    expect(data.yesterday).toEqual({ completed: 2, failed: 1 });
  });

  it("compares sqlite CURRENT_TIMESTAMP rows against the same UTC window", async () => {
    // No ended_at: the fallback lands on created_at, whose sqlite format has
    // no `T`. Without the normalisation both sides would never compare.
    seedSession("s1", "p1", {
      status: "completed",
      endedAt: null,
      completedAt: null,
      createdAt: sqliteStamp(2 * 3600_000),
    });
    seedSession("s2", "p1", {
      status: "failed",
      endedAt: null,
      completedAt: null,
      createdAt: sqliteStamp(30 * 3600_000),
    });

    const data = await callRoute();

    expect(data.yesterday).toEqual({ completed: 1, failed: 0 });
  });
});
