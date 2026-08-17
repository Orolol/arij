/**
 * lib/agent-sessions/wait-for-completion.ts — the extracted wait loop the
 * build/review/merge (and sibling) routes previously hand-rolled. The exact
 * semantics matter:
 *
 *   - synchronous first check: an untracked or already-terminal session
 *     resolves without ever sleeping,
 *   - polls every 2s (default) while the session reports 'running',
 *   - returns the final SessionInfo (result included) or null when the
 *     session is not tracked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const pmState = vi.hoisted(() => ({
  sessions: new Map<string, { status: string; result?: unknown }>(),
  getStatusCalls: 0,
}));

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    getStatus: vi.fn((sessionId: string) => {
      pmState.getStatusCalls += 1;
      const tracked = pmState.sessions.get(sessionId);
      return tracked
        ? { sessionId, status: tracked.status, result: tracked.result }
        : null;
    }),
  },
}));

const { waitForProcessCompletion, DEFAULT_COMPLETION_POLL_INTERVAL_MS } =
  await import("@/lib/agent-sessions/wait-for-completion");

beforeEach(() => {
  vi.useFakeTimers();
  pmState.sessions.clear();
  pmState.getStatusCalls = 0;
});

describe("waitForProcessCompletion", () => {
  it("returns null immediately for an untracked session (no sleep)", async () => {
    const result = await waitForProcessCompletion("sess-unknown");

    expect(result).toBeNull();
    expect(pmState.getStatusCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns an already-terminal session without sleeping", async () => {
    pmState.sessions.set("sess-done", {
      status: "completed",
      result: { success: true },
    });

    const result = await waitForProcessCompletion("sess-done");

    expect(result).toMatchObject({
      status: "completed",
      result: { success: true },
    });
    expect(pmState.getStatusCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls on the default 2s cadence until the session settles", async () => {
    pmState.sessions.set("sess-run", { status: "running" });

    const promise = waitForProcessCompletion("sess-run");

    // Two full polls while still running…
    await vi.advanceTimersByTimeAsync(DEFAULT_COMPLETION_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(DEFAULT_COMPLETION_POLL_INTERVAL_MS);
    expect(pmState.getStatusCalls).toBe(3);

    // …then the CLI finishes and the next poll returns the result.
    pmState.sessions.set("sess-run", {
      status: "failed",
      result: { success: false, error: "boom" },
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_COMPLETION_POLL_INTERVAL_MS);

    await expect(promise).resolves.toMatchObject({
      status: "failed",
      result: { success: false, error: "boom" },
    });
  });

  it("honors a custom poll interval", async () => {
    pmState.sessions.set("sess-fast", { status: "running" });

    const promise = waitForProcessCompletion("sess-fast", 1200);

    // Under the custom interval nothing has fired yet at 1100ms.
    await vi.advanceTimersByTimeAsync(1100);
    expect(pmState.getStatusCalls).toBe(1);

    pmState.sessions.set("sess-fast", {
      status: "completed",
      result: { success: true },
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toMatchObject({ status: "completed" });
    expect(pmState.getStatusCalls).toBe(2);
  });
});
