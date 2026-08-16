/**
 * Integration tests for the persisted delivery verdict:
 *   - migration 0023 applies through the real chain (createTestDb),
 *   - markSessionTerminal threads the outcome into the agent_sessions row,
 *   - failed sessions default to 'error', cancelled sessions stay NULL.
 */
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db, sqlite } = await import("@/lib/db");
const { agentSessions, projects } = await import("@/lib/db/schema");
const {
  createQueuedSession,
  markSessionRunning,
  markSessionTerminal,
  markSessionCancelled,
} = await import("@/lib/agent-sessions/lifecycle");

const PROJECT_ID = "proj-outcome";

function seedProjectOnce(): void {
  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, PROJECT_ID))
    .get();
  if (existing) return;
  db.insert(projects).values({ id: PROJECT_ID, name: "Outcome Test" }).run();
}

function createRunningSession(sessionId: string): void {
  seedProjectOnce();
  createQueuedSession({
    id: sessionId,
    projectId: PROJECT_ID,
    agentType: "build",
    createdAt: "2026-08-16T09:00:00.000Z",
  });
  markSessionRunning(sessionId, "2026-08-16T09:00:01.000Z");
}

function readSession(sessionId: string) {
  return db
    .select({
      status: agentSessions.status,
      outcome: agentSessions.outcome,
      error: agentSessions.error,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
}

describe("migration 0023 (agent_sessions.outcome)", () => {
  it("adds the nullable outcome column via the migration chain", () => {
    const columns = (
      sqlite
        .prepare("PRAGMA table_info(agent_sessions)")
        .all() as Array<{ name: string; type: string; notnull: number }>
    );
    const outcome = columns.find((c) => c.name === "outcome");
    expect(outcome).toBeDefined();
    expect(outcome!.type).toBe("TEXT");
    expect(outcome!.notnull).toBe(0);
  });

  it("leaves outcome NULL for freshly queued sessions", () => {
    createRunningSession("s-fresh");
    expect(readSession("s-fresh")).toMatchObject({
      status: "running",
      outcome: null,
    });
  });
});

describe("markSessionTerminal outcome persistence", () => {
  it("persists an explicit asked_question verdict", () => {
    createRunningSession("s-asked");
    markSessionTerminal(
      "s-asked",
      { success: true, error: null, outcome: "asked_question" },
      "2026-08-16T09:05:00.000Z"
    );
    expect(readSession("s-asked")).toMatchObject({
      status: "completed",
      outcome: "asked_question",
    });
  });

  it("persists answered and silent verdicts", () => {
    createRunningSession("s-answered");
    markSessionTerminal("s-answered", {
      success: true,
      outcome: "answered",
    });
    expect(readSession("s-answered")).toMatchObject({
      status: "completed",
      outcome: "answered",
    });

    createRunningSession("s-silent");
    markSessionTerminal("s-silent", { success: true, outcome: "silent" });
    expect(readSession("s-silent")).toMatchObject({
      status: "completed",
      outcome: "silent",
    });
  });

  it("defaults failed sessions to the error verdict when none is provided", () => {
    createRunningSession("s-failed");
    markSessionTerminal("s-failed", {
      success: false,
      error: "CLI exited with code 1",
    });
    expect(readSession("s-failed")).toMatchObject({
      status: "failed",
      outcome: "error",
      error: "CLI exited with code 1",
    });
  });

  it("leaves successful sessions unclassified when no verdict is provided", () => {
    createRunningSession("s-unclassified");
    markSessionTerminal("s-unclassified", { success: true });
    expect(readSession("s-unclassified")).toMatchObject({
      status: "completed",
      outcome: null,
    });
  });

  it("keeps cancelled sessions unclassified (no delivery verdict)", () => {
    createRunningSession("s-cancelled");
    markSessionCancelled("s-cancelled");
    expect(readSession("s-cancelled")).toMatchObject({
      status: "cancelled",
      outcome: null,
      error: "Cancelled by user",
    });
  });
});
