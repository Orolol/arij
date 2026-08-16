/**
 * Unit tests for the in-process agent scheduler (lib/agents/scheduler.ts):
 * FIFO dispatch under a per-project budget, per-project isolation, slot
 * release on completion AND failure, introspection counts, queue removal,
 * and settings-based budget resolution.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
} from "@/__tests__/helpers/db-mock";

const lifecycleMocks = vi.hoisted(() => ({
  markSessionTerminal: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/agent-sessions/lifecycle", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/agent-sessions/lifecycle")
  >("@/lib/agent-sessions/lifecycle");
  return {
    ...actual,
    markSessionTerminal: lifecycleMocks.markSessionTerminal,
  };
});

const { AgentScheduler, resolveMaxConcurrentForProject } = await import(
  "@/lib/agents/scheduler"
);
const { parseMaxConcurrentSetting } = await import(
  "@/lib/agents/scheduler-constants"
);

/** Launch closure whose settlement the test controls. */
function controlledLaunch(started: string[], sessionId: string) {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const launch = () => {
    started.push(sessionId);
    return promise;
  };
  return { launch, resolve, reject };
}

async function settle() {
  // Let the scheduler's .catch/.finally chain run.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
});

describe("AgentScheduler dispatch", () => {
  it("starts immediately under the budget and reports it", () => {
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 2 });
    const started: string[] = [];

    const a = controlledLaunch(started, "a");
    const result = scheduler.submit("proj-1", "a", a.launch);

    expect(result).toEqual({ started: true, queuedAhead: 0 });
    expect(started).toEqual(["a"]);
    expect(scheduler.getCounts("proj-1")).toEqual({ running: 1, queued: 0 });
  });

  it("queues FIFO past the budget and drains in order as slots free", async () => {
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });
    const started: string[] = [];

    const a = controlledLaunch(started, "a");
    const b = controlledLaunch(started, "b");
    const c = controlledLaunch(started, "c");

    expect(scheduler.submit("proj-1", "a", a.launch).started).toBe(true);
    expect(scheduler.submit("proj-1", "b", b.launch)).toEqual({
      started: false,
      queuedAhead: 0,
    });
    expect(scheduler.submit("proj-1", "c", c.launch)).toEqual({
      started: false,
      queuedAhead: 1,
    });

    expect(started).toEqual(["a"]);
    expect(scheduler.getCounts("proj-1")).toEqual({ running: 1, queued: 2 });

    a.resolve();
    await settle();
    expect(started).toEqual(["a", "b"]);
    expect(scheduler.getCounts("proj-1")).toEqual({ running: 1, queued: 1 });

    b.resolve();
    await settle();
    expect(started).toEqual(["a", "b", "c"]);

    c.resolve();
    await settle();
    expect(scheduler.getCounts("proj-1")).toEqual({ running: 0, queued: 0 });
    expect(lifecycleMocks.markSessionTerminal).not.toHaveBeenCalled();
  });

  it("isolates budgets per project", () => {
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });
    const started: string[] = [];

    const a = controlledLaunch(started, "p1-a");
    const b = controlledLaunch(started, "p1-b");
    const c = controlledLaunch(started, "p2-a");

    scheduler.submit("proj-1", "p1-a", a.launch);
    scheduler.submit("proj-1", "p1-b", b.launch);
    const other = scheduler.submit("proj-2", "p2-a", c.launch);

    // proj-1's backlog does not block proj-2.
    expect(other.started).toBe(true);
    expect(started).toEqual(["p1-a", "p2-a"]);
    expect(scheduler.listCounts()).toEqual([
      { projectId: "proj-1", running: 1, queued: 1 },
      { projectId: "proj-2", running: 1, queued: 0 },
    ]);
  });

  it("frees the slot when a launch fails and marks the session failed", async () => {
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });
    const started: string[] = [];

    const a = controlledLaunch(started, "a");
    const b = controlledLaunch(started, "b");
    scheduler.submit("proj-1", "a", a.launch);
    scheduler.submit("proj-1", "b", b.launch);

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    a.reject(new Error("spawn exploded"));
    await settle();
    consoleError.mockRestore();

    // Next queued launch started despite the failure...
    expect(started).toEqual(["a", "b"]);
    // ...and the safety net finalized the crashed session.
    expect(lifecycleMocks.markSessionTerminal).toHaveBeenCalledWith("a", {
      success: false,
      error: "spawn exploded",
    });

    b.resolve();
    await settle();
  });

  it("funnels synchronous launch throws into the failure path without breaking submit", async () => {
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });
    const started: string[] = [];
    const b = controlledLaunch(started, "b");

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(() =>
      scheduler.submit("proj-1", "a", () => {
        throw new Error("sync boom");
      })
    ).not.toThrow();
    scheduler.submit("proj-1", "b", b.launch);

    await settle();
    consoleError.mockRestore();

    expect(started).toEqual(["b"]);
    expect(lifecycleMocks.markSessionTerminal).toHaveBeenCalledWith("a", {
      success: false,
      error: "sync boom",
    });

    b.resolve();
    await settle();
  });

  it("stays silent when the launch dies on a lifecycle conflict (cancelled while queued)", async () => {
    const { SessionLifecycleConflictError } = await vi.importActual<
      typeof import("@/lib/agent-sessions/lifecycle")
    >("@/lib/agent-sessions/lifecycle");

    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    scheduler.submit("proj-1", "a", async () => {
      throw new SessionLifecycleConflictError({
        sessionId: "a",
        fromStatus: "cancelled",
        toStatus: "running",
      });
    });
    await settle();

    expect(consoleError).not.toHaveBeenCalled();
    expect(lifecycleMocks.markSessionTerminal).not.toHaveBeenCalled();
    expect(scheduler.getCounts("proj-1")).toEqual({ running: 0, queued: 0 });
    consoleError.mockRestore();
  });

  it("removes queued entries (cancel) but not running ones", async () => {
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });
    const started: string[] = [];

    const a = controlledLaunch(started, "a");
    const b = controlledLaunch(started, "b");
    const c = controlledLaunch(started, "c");
    scheduler.submit("proj-1", "a", a.launch);
    scheduler.submit("proj-1", "b", b.launch);
    scheduler.submit("proj-1", "c", c.launch);

    expect(scheduler.remove("b")).toBe(true);
    expect(scheduler.remove("b")).toBe(false); // already gone
    expect(scheduler.remove("a")).toBe(false); // running, not queued
    expect(scheduler.remove("nope")).toBe(false);
    expect(scheduler.getCounts("proj-1")).toEqual({ running: 1, queued: 1 });

    a.resolve();
    await settle();

    // b never started; c took the slot instead.
    expect(started).toEqual(["a", "c"]);
    c.resolve();
    await settle();
  });

  it("rejects double-submission of the same session id", () => {
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });
    const started: string[] = [];
    const a = controlledLaunch(started, "a");
    const b = controlledLaunch(started, "b");

    scheduler.submit("proj-1", "a", a.launch);
    scheduler.submit("proj-1", "b", b.launch);

    expect(() => scheduler.submit("proj-1", "a", a.launch)).toThrow(
      /already scheduled/
    );
    expect(() => scheduler.submit("proj-1", "b", b.launch)).toThrow(
      /already scheduled/
    );
  });

  it("re-reads the budget on release so a raised limit drains several at once", async () => {
    let limit = 1;
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => limit });
    const started: string[] = [];

    const a = controlledLaunch(started, "a");
    const b = controlledLaunch(started, "b");
    const c = controlledLaunch(started, "c");
    scheduler.submit("proj-1", "a", a.launch);
    scheduler.submit("proj-1", "b", b.launch);
    scheduler.submit("proj-1", "c", c.launch);
    expect(started).toEqual(["a"]);

    limit = 3;
    a.resolve();
    await settle();

    expect(started).toEqual(["a", "b", "c"]);
    b.resolve();
    c.resolve();
    await settle();
  });

  it("falls back to the default budget when the resolver misbehaves", () => {
    const scheduler = new AgentScheduler({
      getMaxConcurrent: () => {
        throw new Error("settings unavailable");
      },
    });
    const started: string[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // First start skips the resolver (idle project); the second consults it,
    // fails, and falls back to the default of 3 — so it still starts.
    const a = controlledLaunch(started, "a");
    const b = controlledLaunch(started, "b");
    scheduler.submit("proj-1", "a", a.launch);
    scheduler.submit("proj-1", "b", b.launch);

    expect(started).toEqual(["a", "b"]);
    consoleError.mockRestore();
  });
});

describe("resolveMaxConcurrentForProject", () => {
  it("prefers the per-project settings key", () => {
    dbMockState.getQueue = [{ value: "5" }];
    expect(resolveMaxConcurrentForProject("proj-1")).toBe(5);
  });

  it("falls back to the global key when the project key is unset", () => {
    dbMockState.getQueue = [null, { value: "2" }];
    expect(resolveMaxConcurrentForProject("proj-1")).toBe(2);
  });

  it("falls back to the built-in default when neither key is set", () => {
    dbMockState.getQueue = [null, null];
    expect(resolveMaxConcurrentForProject("proj-1")).toBe(3);
  });

  it("skips invalid values (zero, negative, junk) instead of honoring them", () => {
    // Project key holds 0 (would deadlock) -> global key junk -> default.
    dbMockState.getQueue = [{ value: "0" }, { value: '"lots"' }];
    expect(resolveMaxConcurrentForProject("proj-1")).toBe(3);
  });
});

describe("parseMaxConcurrentSetting", () => {
  it("accepts JSON numbers, numeric strings, and double-encoded strings", () => {
    expect(parseMaxConcurrentSetting("4")).toBe(4);
    expect(parseMaxConcurrentSetting(4)).toBe(4);
    expect(parseMaxConcurrentSetting('"4"')).toBe(4);
  });

  it("rejects non-positive, fractional, and non-numeric values", () => {
    expect(parseMaxConcurrentSetting("0")).toBeNull();
    expect(parseMaxConcurrentSetting("-2")).toBeNull();
    expect(parseMaxConcurrentSetting("2.5")).toBeNull();
    expect(parseMaxConcurrentSetting("banana")).toBeNull();
    expect(parseMaxConcurrentSetting(null)).toBeNull();
    expect(parseMaxConcurrentSetting(undefined)).toBeNull();
    expect(parseMaxConcurrentSetting("")).toBeNull();
  });
});
