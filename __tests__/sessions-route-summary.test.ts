/**
 * `GET /api/projects/:id/sessions?summary=1` — the Sessions page's synthesis
 * band, computed in SQL (lot 07, #114).
 *
 * The band used to be derived on the client from the WHOLE list, which forced
 * the page to walk every keyset page on every mount just to fill four cells.
 * The aggregate is asserted against a real SQLite database so the SQL — the
 * status normalisation, the "today" bound, the cost sum — is what is tested,
 * not a chain mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/agent-sessions/backfill", () => ({
  runBackfillRecentSessionLastNonEmptyTextOnce: vi.fn(),
}));

vi.mock("@/lib/agent-sessions/chunks", () => ({
  lastSessionChunkAt: () => null,
}));

const { db } = await import("@/lib/db");
const { agentSessions, chatConversations, projects } = await import("@/lib/db/schema");
const { GET } = await import("@/app/api/projects/[projectId]/sessions/route");

const PROJECT_ID = "summary-project";
const SINCE = "2026-09-11T00:00:00.000Z";

async function get(searchParams: Record<string, string>) {
  const response = await GET(
    mockNextRequest({ searchParams }),
    mockRouteContext({ projectId: PROJECT_ID })
  );
  return { status: response.status, body: await response.json() };
}

let counter = 0;
function session(values: {
  status: string | null;
  createdAt: string;
  totalCostUsd?: number | null;
  projectId?: string;
}) {
  counter += 1;
  db.insert(agentSessions)
    .values({
      id: `s-${counter}`,
      projectId: values.projectId ?? PROJECT_ID,
      status: values.status,
      createdAt: values.createdAt,
      totalCostUsd: values.totalCostUsd ?? null,
    })
    .run();
}

beforeEach(() => {
  db.delete(agentSessions).run();
  db.delete(chatConversations).run();
  db.delete(projects).run();
  db.insert(projects)
    .values([
      { id: PROJECT_ID, name: "Summary" },
      { id: "other-project", name: "Other" },
    ])
    .run();
});

describe("sessions list route — ?summary=1", () => {
  it("counts the band's four cells in SQL, over every session of the project", async () => {
    // Live, whatever their age.
    session({ status: "running", createdAt: "2026-08-01T10:00:00.000Z" });
    session({ status: "queued", createdAt: "2026-09-11T09:00:00.000Z" });
    // Legacy spelling of queued, normalised the way the list normalises it.
    session({ status: "pending", createdAt: "2026-09-02T09:00:00.000Z" });
    // No status at all: the list serves it as "queued" (getSessionStatusForApi).
    session({ status: null, createdAt: "2026-09-03T09:00:00.000Z" });
    // Terminal today: ISO and SQLite's CURRENT_TIMESTAMP shape both count.
    session({ status: "completed", createdAt: "2026-09-11T08:00:00.000Z", totalCostUsd: 0.5 });
    session({ status: "completed", createdAt: "2026-09-11 07:30:00", totalCostUsd: 0.25 });
    session({ status: "failed", createdAt: "2026-09-11T01:00:00.000Z", totalCostUsd: 1 });
    session({ status: "cancelled", createdAt: "2026-09-11T02:00:00.000Z" });
    // Terminal but before `since`, and another project's today: neither counts.
    session({ status: "completed", createdAt: "2026-09-10T23:59:59.000Z", totalCostUsd: 9 });
    session({ status: "completed", createdAt: "2026-09-11T08:00:00.000Z", totalCostUsd: 9, projectId: "other-project" });

    const { status, body } = await get({ summary: "1", since: SINCE, limit: "1" });

    expect(status).toBe(200);
    expect(body.summary).toEqual({
      running: 1,
      queued: 3,
      today: 4,
      todayCompleted: 2,
      todayFailed: 1,
      todayCostUsd: 1.75,
      since: SINCE,
    });
    // Independent of the page: one row served, the aggregate still covers all.
    expect(body.data).toHaveLength(1);
    expect(body.nextCursor).toBeTruthy();
  });

  it("honours the caller's local midnight, offset included", async () => {
    session({ status: "completed", createdAt: "2026-09-10T23:30:00.000Z" });
    // Midnight in UTC+02:00 is 22:00 UTC the day before.
    const { body } = await get({ summary: "1", since: "2026-09-11T00:00:00+02:00" });
    expect(body.summary.today).toBe(1);
    expect(body.summary.since).toBe("2026-09-10T22:00:00.000Z");
  });

  it("answers zeros, not nulls, for a project with no session", async () => {
    const { body } = await get({ summary: "1", since: SINCE });
    expect(body.summary).toMatchObject({
      running: 0,
      queued: 0,
      today: 0,
      todayCompleted: 0,
      todayFailed: 0,
      todayCostUsd: 0,
    });
  });

  it("is absent unless asked for, so the pages after the first stay as they were", async () => {
    session({ status: "running", createdAt: SINCE });
    const { body } = await get({});
    expect(body).not.toHaveProperty("summary");
  });

  it("refuses a `since` that is not a timestamp", async () => {
    const { status, body } = await get({ summary: "1", since: "yesterday-ish" });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});
