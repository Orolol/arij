/**
 * Integration tests for usage persistence (migration 0024 columns):
 *   - markSessionTerminal threads the optional usage field into the
 *     agent_sessions row at the same choke point as the delivery verdict,
 *   - omitted / partial / non-finite usage never fabricates values,
 *   - non-terminal transitions and cancellations leave the columns NULL.
 */
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const { agentSessions, projects } = await import("@/lib/db/schema");
const {
  buildSessionTransitionPatch,
  createQueuedSession,
  markSessionRunning,
  markSessionTerminal,
  markSessionCancelled,
} = await import("@/lib/agent-sessions/lifecycle");

const PROJECT_ID = "proj-usage";

function seedProjectOnce(): void {
  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, PROJECT_ID))
    .get();
  if (existing) return;
  db.insert(projects).values({ id: PROJECT_ID, name: "Usage Test" }).run();
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
      inputTokens: agentSessions.inputTokens,
      outputTokens: agentSessions.outputTokens,
      totalCostUsd: agentSessions.totalCostUsd,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
}

describe("markSessionTerminal usage persistence", () => {
  it("persists reported usage on completed sessions", () => {
    createRunningSession("u-completed");
    markSessionTerminal(
      "u-completed",
      {
        success: true,
        outcome: "answered",
        usage: { inputTokens: 29255, outputTokens: 260, totalCostUsd: 0.084 },
      },
      "2026-08-16T09:05:00.000Z"
    );
    expect(readSession("u-completed")).toMatchObject({
      status: "completed",
      inputTokens: 29255,
      outputTokens: 260,
      totalCostUsd: 0.084,
    });
  });

  it("persists usage on failed sessions too (failed runs cost money)", () => {
    createRunningSession("u-failed");
    markSessionTerminal("u-failed", {
      success: false,
      error: "CLI exited with code 1",
      usage: { inputTokens: 10, outputTokens: 5, totalCostUsd: 0.02 },
    });
    expect(readSession("u-failed")).toMatchObject({
      status: "failed",
      inputTokens: 10,
      outputTokens: 5,
      totalCostUsd: 0.02,
    });
  });

  it("leaves all usage columns NULL when the provider reported nothing", () => {
    createRunningSession("u-none");
    markSessionTerminal("u-none", { success: true, outcome: "answered" });
    expect(readSession("u-none")).toMatchObject({
      status: "completed",
      inputTokens: null,
      outputTokens: null,
      totalCostUsd: null,
    });
  });

  it("persists partial usage without faking the missing fields to zero", () => {
    createRunningSession("u-partial");
    markSessionTerminal("u-partial", {
      success: true,
      usage: { totalCostUsd: 0.01 },
    });
    expect(readSession("u-partial")).toMatchObject({
      status: "completed",
      inputTokens: null,
      outputTokens: null,
      totalCostUsd: 0.01,
    });
  });

  it("ignores non-finite usage values", () => {
    createRunningSession("u-nonfinite");
    markSessionTerminal("u-nonfinite", {
      success: true,
      usage: {
        inputTokens: Number.NaN,
        outputTokens: Number.POSITIVE_INFINITY,
        totalCostUsd: 0.5,
      },
    });
    expect(readSession("u-nonfinite")).toMatchObject({
      status: "completed",
      inputTokens: null,
      outputTokens: null,
      totalCostUsd: 0.5,
    });
  });

  it("keeps cancelled sessions at NULL usage", () => {
    createRunningSession("u-cancelled");
    markSessionCancelled("u-cancelled");
    expect(readSession("u-cancelled")).toMatchObject({
      status: "cancelled",
      inputTokens: null,
      outputTokens: null,
      totalCostUsd: null,
    });
  });
});

describe("buildSessionTransitionPatch usage handling", () => {
  it("only applies usage on terminal transitions", () => {
    const runningPatch = buildSessionTransitionPatch(
      {
        id: "s",
        status: "queued",
        startedAt: null,
        endedAt: null,
        completedAt: null,
      },
      "running",
      "2026-08-16T09:00:00.000Z",
      undefined,
      undefined,
      { inputTokens: 5, outputTokens: 5, totalCostUsd: 0.1 }
    );
    expect(runningPatch.inputTokens).toBeUndefined();
    expect(runningPatch.outputTokens).toBeUndefined();
    expect(runningPatch.totalCostUsd).toBeUndefined();

    const terminalPatch = buildSessionTransitionPatch(
      {
        id: "s",
        status: "running",
        startedAt: "2026-08-16T09:00:00.000Z",
        endedAt: null,
        completedAt: null,
      },
      "completed",
      "2026-08-16T09:01:00.000Z",
      undefined,
      undefined,
      { inputTokens: 5, outputTokens: 6, totalCostUsd: 0.1 }
    );
    expect(terminalPatch).toMatchObject({
      status: "completed",
      inputTokens: 5,
      outputTokens: 6,
      totalCostUsd: 0.1,
    });
  });
});
