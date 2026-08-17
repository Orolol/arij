/**
 * Run-level stop control:
 *
 *   - the registry flag (`requestStop` / `isStopRequested`): active runs
 *     only, idempotent, never resurrects a finished run,
 *   - POST /api/projects/[projectId]/build/night-runs/[runId]/stop: the
 *     envelope `{ data: { stopping: true } }`, the 404s (unknown project,
 *     unknown run, run of another project, already-finished run), and the
 *     flag actually flipping on the registry entry,
 *   - the flag surfacing on GET detail as `stopRequested` so the dialog can
 *     show "Stopping…" across a remount.
 *
 * The registry is the real singleton (the route and the engine share it);
 * only the database is a migrated in-memory one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockJsonRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const { projects, agentSessions, epics } = await import("@/lib/db/schema");
const { POST: stopPost } = await import(
  "@/app/api/projects/[projectId]/build/night-runs/[runId]/stop/route"
);
const { GET: detailGet } = await import(
  "@/app/api/projects/[projectId]/build/night-runs/[runId]/route"
);
const { NightRunRegistry, nightRunRegistry } = await import(
  "@/lib/night/registry"
);
import type { NightRunSnapshot } from "@/lib/night/registry";
import type { NightRunDetail } from "@/lib/night/constants";

let counter = 0;

function snapshot(
  runId: string,
  projectId: string,
  overrides: Partial<NightRunSnapshot> = {}
): NightRunSnapshot {
  return {
    runId,
    projectId,
    failurePolicy: "halt",
    breakerThreshold: 3,
    costCapUsd: null,
    state: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    currentWave: 1,
    totalWaves: 2,
    totalEpics: 2,
    counts: { pending: 1, running: 1, done: 0, asked: 0, failed: 0, skipped: 0 },
    epics: [],
    stopRequested: false,
    abortReason: null,
    abortedAtWave: null,
    ...overrides,
  };
}

function seedProject(): string {
  counter += 1;
  const projectId = `proj-stop-${counter}`;
  db.insert(projects)
    .values({ id: projectId, name: `Stop ${counter}`, gitRepoPath: "/r" })
    .run();
  return projectId;
}

async function postStop(projectId: string, runId: string) {
  const res = await stopPost(
    mockJsonRequest(null),
    mockRouteContext({ projectId, runId })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.delete(agentSessions).run();
  db.delete(epics).run();
  db.delete(projects).run();
});

describe("NightRunRegistry — stop flag", () => {
  it("flags an active run, idempotently", () => {
    const registry = new NightRunRegistry();
    registry.register(snapshot("night_r1", "p1"));

    expect(registry.isStopRequested("night_r1")).toBe(false);
    expect(registry.requestStop("night_r1")).toBe(true);
    expect(registry.isStopRequested("night_r1")).toBe(true);
    // Repeat requests stay truthy — a double click is not an error.
    expect(registry.requestStop("night_r1")).toBe(true);
    expect(registry.get("night_r1")!.stopRequested).toBe(true);
  });

  it("refuses unknown and finished runs", () => {
    const registry = new NightRunRegistry();
    expect(registry.requestStop("night_missing")).toBe(false);
    expect(registry.isStopRequested("night_missing")).toBe(false);

    registry.register(snapshot("night_r2", "p1"));
    registry.finish("night_r2");
    expect(registry.requestStop("night_r2")).toBe(false);
    // The terminal ring entry is untouched — nothing to stop, nothing lied to.
    expect(registry.get("night_r2")!.stopRequested).toBe(false);
    expect(registry.isStopRequested("night_r2")).toBe(false);
  });

  it("keeps the flag when the run moves into the terminal ring", () => {
    const registry = new NightRunRegistry();
    registry.register(snapshot("night_r3", "p1"));
    registry.requestStop("night_r3");
    registry.finish("night_r3");

    expect(registry.get("night_r3")!.stopRequested).toBe(true);
    // …but a finished run is no longer "stop requested" for the engine.
    expect(registry.isStopRequested("night_r3")).toBe(false);
  });
});

describe("POST /build/night-runs/[runId]/stop", () => {
  it("flags the run and answers { data: { stopping: true } }", async () => {
    const projectId = seedProject();
    const runId = `night_${counter}_ok`;
    nightRunRegistry.register(snapshot(runId, projectId));

    const { status, body } = await postStop(projectId, runId);

    expect(status).toBe(200);
    expect(body).toEqual({ data: { stopping: true } });
    expect(nightRunRegistry.isStopRequested(runId)).toBe(true);

    // The engine has not run yet — the run is still active, not finished.
    expect(nightRunRegistry.get(runId)!.state).toBe("running");
    nightRunRegistry.finish(runId);
  });

  it("is idempotent (a second stop still answers 200)", async () => {
    const projectId = seedProject();
    const runId = `night_${counter}_twice`;
    nightRunRegistry.register(snapshot(runId, projectId));

    expect((await postStop(projectId, runId)).status).toBe(200);
    expect((await postStop(projectId, runId)).status).toBe(200);
    expect(nightRunRegistry.isStopRequested(runId)).toBe(true);
    nightRunRegistry.finish(runId);
  });

  it("404s an unknown run id", async () => {
    const projectId = seedProject();
    const { status, body } = await postStop(projectId, "night_nope");
    expect(status).toBe(404);
    expect(body.error).toMatch(/night run/i);
  });

  it("404s a run that belongs to another project", async () => {
    const owner = seedProject();
    const other = seedProject();
    const runId = `night_${counter}_owned`;
    nightRunRegistry.register(snapshot(runId, owner));

    const { status } = await postStop(other, runId);
    expect(status).toBe(404);
    // Crucially the flag was NOT set by the foreign request.
    expect(nightRunRegistry.isStopRequested(runId)).toBe(false);
    nightRunRegistry.finish(runId);
  });

  it("404s a run that already finished", async () => {
    const projectId = seedProject();
    const runId = `night_${counter}_done`;
    nightRunRegistry.register(snapshot(runId, projectId));
    nightRunRegistry.finish(runId);

    const { status } = await postStop(projectId, runId);
    expect(status).toBe(404);
    expect(nightRunRegistry.get(runId)!.stopRequested).toBe(false);
  });

  it("404s an unknown project before touching the registry", async () => {
    const runId = "night_ghost_project";
    nightRunRegistry.register(snapshot(runId, "proj-does-not-exist"));

    const { status, body } = await postStop("proj-does-not-exist", runId);
    expect(status).toBe(404);
    expect(body.error).toBe("Project not found");
    expect(nightRunRegistry.isStopRequested(runId)).toBe(false);
    nightRunRegistry.finish(runId);
  });
});

describe("GET /build/night-runs/[runId] — stopRequested", () => {
  it("surfaces the flag on the live run and never on a DB-derived one", async () => {
    const projectId = seedProject();
    const runId = `night_${counter}_detail`;
    nightRunRegistry.register(snapshot(runId, projectId));

    const before = await detailGet(
      mockJsonRequest(null),
      mockRouteContext({ projectId, runId })
    );
    expect(((await before.json()).data as NightRunDetail).stopRequested).toBe(
      false
    );

    await postStop(projectId, runId);

    const after = await detailGet(
      mockJsonRequest(null),
      mockRouteContext({ projectId, runId })
    );
    expect(((await after.json()).data as NightRunDetail).stopRequested).toBe(
      true
    );

    // A run only the database knows about (registry wiped by a restart)
    // cannot be "stopping" — there is no engine left to tell.
    const orphanRunId = `night_${counter}_orphan`;
    db.insert(agentSessions)
      .values({
        id: `sess-${counter}-orphan`,
        projectId,
        status: "completed",
        outcome: "answered",
        agentType: "build",
        batchRunId: orphanRunId,
        createdAt: new Date().toISOString(),
      })
      .run();

    const derived = await detailGet(
      mockJsonRequest(null),
      mockRouteContext({ projectId, runId: orphanRunId })
    );
    const derivedDetail = (await derived.json()).data as NightRunDetail;
    expect(derivedDetail.source).toBe("db");
    expect(derivedDetail.stopRequested).toBe(false);

    nightRunRegistry.finish(runId);
  });
});
