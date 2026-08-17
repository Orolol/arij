/**
 * Session terminal hook (lib/agent-sessions/terminal-hooks.ts) at the
 * lifecycle choke point: every terminal transition through
 * transitionSessionStatus notifies the boot-registered hook exactly once,
 * non-terminal transitions never do, a throwing hook cannot break the
 * transition, and the default (no hook registered) is a strict no-op.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const { projects, agentSessions } = await import("@/lib/db/schema");
const { markSessionRunning, markSessionTerminal, markSessionCancelled } =
  await import("@/lib/agent-sessions/lifecycle");
const { setSessionTerminalHook, notifySessionTerminal } = await import(
  "@/lib/agent-sessions/terminal-hooks"
);

let counter = 0;

function seedSession(status = "queued"): string {
  counter += 1;
  const projectId = `proj-hook-${counter}`;
  const sessionId = `sess-hook-${counter}`;
  db.insert(projects).values({ id: projectId, name: "Hook Project" }).run();
  db.insert(agentSessions)
    .values({ id: sessionId, projectId, status })
    .run();
  return sessionId;
}

const hook = vi.fn();

beforeEach(() => {
  hook.mockReset();
  setSessionTerminalHook(hook);
});

afterEach(() => {
  setSessionTerminalHook(null);
});

describe("lifecycle terminal notifications", () => {
  it("notifies once per terminal transition with the final status", () => {
    const completedId = seedSession("running");
    markSessionTerminal(completedId, { success: true, outcome: "answered" });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({
      sessionId: completedId,
      status: "completed",
    });

    const failedId = seedSession("running");
    markSessionTerminal(failedId, { success: false, error: "boom" });
    expect(hook).toHaveBeenLastCalledWith({
      sessionId: failedId,
      status: "failed",
    });

    const cancelledId = seedSession("queued");
    markSessionCancelled(cancelledId);
    expect(hook).toHaveBeenLastCalledWith({
      sessionId: cancelledId,
      status: "cancelled",
    });
    expect(hook).toHaveBeenCalledTimes(3);
  });

  it("does not notify for non-terminal transitions", () => {
    const sessionId = seedSession("queued");
    markSessionRunning(sessionId);
    expect(hook).not.toHaveBeenCalled();
  });

  it("a throwing hook never breaks the transition", () => {
    hook.mockImplementation(() => {
      throw new Error("hook exploded");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sessionId = seedSession("running");
    expect(() =>
      markSessionTerminal(sessionId, { success: true })
    ).not.toThrow();

    const row = db
      .select({ status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(row?.status).toBe("completed");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op when no hook is registered (the default)", () => {
    setSessionTerminalHook(null);
    expect(() =>
      notifySessionTerminal({ sessionId: "x", status: "completed" })
    ).not.toThrow();
  });
});
