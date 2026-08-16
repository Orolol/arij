/**
 * Tests for the boot sweep that cancels agent sessions orphaned in 'queued'
 * by a dead server process (lib/agent-sessions/boot-cleanup.ts), plus its
 * wiring in instrumentation.ts, against the real migrated schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db, ensureDbReady } = await import("@/lib/db");
const { projects, agentSessions } = await import("@/lib/db/schema");
const { cancelOrphanedQueuedSessions, ORPHANED_BY_RESTART_REASON } =
  await import("@/lib/agent-sessions/boot-cleanup");

let counter = 0;

function seedSession(status: string, extra: Record<string, unknown> = {}) {
  counter += 1;
  const projectId = `proj-boot-${counter}`;
  const sessionId = `sess-boot-${counter}`;
  db.insert(projects)
    .values({ id: projectId, name: "Boot", gitRepoPath: "/repos/boot" })
    .run();
  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId,
      status,
      createdAt: new Date().toISOString(),
      ...extra,
    })
    .run();
  return sessionId;
}

function getSession(sessionId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
}

beforeEach(() => {
  vi.clearAllMocks();
  db.delete(agentSessions).run();
});

describe("cancelOrphanedQueuedSessions", () => {
  it("cancels queued sessions with the orphaned-by-restart reason", () => {
    const queuedId = seedSession("queued");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const cancelled = cancelOrphanedQueuedSessions();
    logSpy.mockRestore();

    expect(cancelled).toBe(1);
    const session = getSession(queuedId);
    expect(session).toMatchObject({
      status: "cancelled",
      error: ORPHANED_BY_RESTART_REASON,
    });
    expect(session!.endedAt).toBeTruthy();
    expect(session!.completedAt).toBeTruthy();
    // Cancellation is not a delivery verdict — outcome stays unclassified.
    expect(session!.outcome).toBeNull();
  });

  it("leaves running and terminal sessions untouched", () => {
    const runningId = seedSession("running", {
      startedAt: new Date().toISOString(),
    });
    const completedId = seedSession("completed");
    const failedId = seedSession("failed", { error: "boom" });
    const cancelledId = seedSession("cancelled", { error: "user" });

    const cancelled = cancelOrphanedQueuedSessions();

    expect(cancelled).toBe(0);
    expect(getSession(runningId)!.status).toBe("running");
    expect(getSession(completedId)!.status).toBe("completed");
    expect(getSession(failedId)!.status).toBe("failed");
    expect(getSession(cancelledId)!.error).toBe("user");
  });

  it("sweeps multiple orphans and returns the count", () => {
    const ids = [
      seedSession("queued"),
      seedSession("queued"),
      seedSession("running", { startedAt: new Date().toISOString() }),
    ];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(cancelOrphanedQueuedSessions()).toBe(2);
    logSpy.mockRestore();

    expect(getSession(ids[0])!.status).toBe("cancelled");
    expect(getSession(ids[1])!.status).toBe("cancelled");
    expect(getSession(ids[2])!.status).toBe("running");
  });

  it("is a no-op on an empty table", () => {
    expect(cancelOrphanedQueuedSessions()).toBe(0);
  });
});

describe("instrumentation register()", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  afterEach(() => {
    if (originalRuntime === undefined) {
      delete process.env.NEXT_RUNTIME;
    } else {
      process.env.NEXT_RUNTIME = originalRuntime;
    }
  });

  it("readies the db then sweeps orphaned queued sessions on the nodejs runtime", async () => {
    const queuedId = seedSession("queued");
    process.env.NEXT_RUNTIME = "nodejs";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { register } = await import("@/instrumentation");
    await register();
    logSpy.mockRestore();

    expect(ensureDbReady).toHaveBeenCalled();
    expect(getSession(queuedId)).toMatchObject({
      status: "cancelled",
      error: ORPHANED_BY_RESTART_REASON,
    });

    // The silent-session watchdog boots alongside the sweep; repeat
    // registrations (dev hot reload) reuse the same ticking singleton.
    const { getSessionWatchdog } = await import("@/lib/agents/watchdog");
    const watchdog = getSessionWatchdog();
    expect(watchdog.isRunning).toBe(true);
    await register();
    expect(getSessionWatchdog()).toBe(watchdog);
    expect(watchdog.isRunning).toBe(true);
    watchdog.stop();
  });

  it("does nothing outside the nodejs runtime", async () => {
    const queuedId = seedSession("queued");
    process.env.NEXT_RUNTIME = "edge";

    const { register } = await import("@/instrumentation");
    await register();

    expect(getSession(queuedId)!.status).toBe("queued");
  });
});
