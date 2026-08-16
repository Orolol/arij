/**
 * Tests for GET /api/projects/[projectId]/epics/[epicId]/activity.
 *
 * Runs the real handler against an isolated in-memory database built from the
 * real migration chain (`createTestDb`), with rows written by the real
 * `logTransition`, so the developer's `data/arij.db` is never touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import {
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";
import { ticketActivityLog, projects, epics } from "@/lib/db/schema";
import { logTransition } from "@/lib/workflow/log";
import { createId } from "@/lib/utils/nanoid";

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

// ---- Import route handler AFTER mocks ----
import { GET } from "@/app/api/projects/[projectId]/epics/[epicId]/activity/route";

let projectId: string;
let epicId: string;
let otherProjectId: string;

function callGet(pid: string, eid: string) {
  return GET(
    mockNextRequest({
      url: `http://localhost/api/projects/${pid}/epics/${eid}/activity`,
    }),
    mockRouteContext({ projectId: pid, epicId: eid })
  );
}

/** Insert an activity row with a controlled timestamp (for ordering tests). */
function seedEntry(overrides: {
  createdAt: string;
  fromStatus?: string;
  toStatus?: string;
  actor?: string;
  reason?: string | null;
  sessionId?: string | null;
  epicId?: string;
}): string {
  const id = createId();
  testDb
    .instance!.db.insert(ticketActivityLog)
    .values({
      id,
      projectId,
      epicId: overrides.epicId ?? epicId,
      fromStatus: overrides.fromStatus ?? "backlog",
      toStatus: overrides.toStatus ?? "todo",
      actor: overrides.actor ?? "user",
      reason: overrides.reason ?? null,
      sessionId: overrides.sessionId ?? null,
      createdAt: overrides.createdAt,
    })
    .run();
  return id;
}

beforeEach(() => {
  testDb.instance = createTestDb();

  projectId = createId();
  otherProjectId = createId();
  epicId = createId();

  const now = new Date().toISOString();
  const { db } = testDb.instance;
  db.insert(projects)
    .values({ id: projectId, name: "Project", createdAt: now, updatedAt: now })
    .run();
  db.insert(projects)
    .values({
      id: otherProjectId,
      name: "Other Project",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(epics)
    .values({
      id: epicId,
      projectId,
      title: "Epic",
      status: "backlog",
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

describe("GET /api/projects/[projectId]/epics/[epicId]/activity", () => {
  it("returns an empty data array for an epic with no activity", async () => {
    const res = await callGet(projectId, epicId);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [] });
  });

  it("returns entries written by logTransition with all fields", async () => {
    logTransition({
      projectId,
      epicId,
      fromStatus: "todo",
      toStatus: "in_progress",
      actor: "agent",
      reason: "Build started",
      sessionId: "session-1",
    });

    const res = await callGet(projectId, epicId);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      projectId,
      epicId,
      fromStatus: "todo",
      toStatus: "in_progress",
      actor: "agent",
      reason: "Build started",
      sessionId: "session-1",
    });
    expect(body.data[0].id).toBeTruthy();
    expect(body.data[0].createdAt).toBeTruthy();
  });

  it("returns entries newest first", async () => {
    const oldest = seedEntry({ createdAt: "2026-01-01T00:00:00.000Z" });
    const newest = seedEntry({ createdAt: "2026-01-03T00:00:00.000Z" });
    const middle = seedEntry({ createdAt: "2026-01-02T00:00:00.000Z" });

    const res = await callGet(projectId, epicId);
    const body = await res.json();

    expect(body.data.map((e: { id: string }) => e.id)).toEqual([
      newest,
      middle,
      oldest,
    ]);
  });

  it("does not leak entries from other epics", async () => {
    const otherEpicId = createId();
    const now = new Date().toISOString();
    testDb
      .instance!.db.insert(epics)
      .values({
        id: otherEpicId,
        projectId,
        title: "Other Epic",
        status: "todo",
        position: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    seedEntry({ createdAt: "2026-01-01T00:00:00.000Z" });
    seedEntry({
      createdAt: "2026-01-02T00:00:00.000Z",
      epicId: otherEpicId,
    });

    const res = await callGet(projectId, epicId);
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].epicId).toBe(epicId);
  });

  it("404s for an unknown epic", async () => {
    const res = await callGet(projectId, "nope");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Epic not found");
  });

  it("404s when the epic belongs to another project (scoped lookup)", async () => {
    seedEntry({ createdAt: "2026-01-01T00:00:00.000Z" });

    const res = await callGet(otherProjectId, epicId);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Epic not found");
  });
});
