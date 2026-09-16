/**
 * The terminal-hook side of the session webhook: a session finalized by a
 * path whose launch closure died first (scheduler safety net, boot cleanup,
 * night/auto-mode engines) must still reach the project's webhook receiver,
 * with the full error message, at the moment the row is finalized.
 *
 * instrumentation.ts composes this into the single terminal hook slot; this
 * suite pins the wrapper's contract (status filtering, cancellation silence,
 * never-throw).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

// Only delivery is stubbed; the payload building stays real.
vi.mock("@/lib/webhooks/send", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webhooks/send")>(
    "@/lib/webhooks/send"
  );
  return { ...actual, sendProjectWebhook: vi.fn(() => Promise.resolve()) };
});

import { sendTerminalSessionWebhook } from "@/lib/agent-sessions/session-outcome-webhook";
import { sendProjectWebhook } from "@/lib/webhooks/send";

const sendMock = vi.mocked(sendProjectWebhook);

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    projectId: "p1",
    epicId: "e1",
    agentType: "build",
    startedAt: "2026-08-16T10:00:00.000Z",
    endedAt: "2026-08-16T10:02:00.000Z",
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("sendTerminalSessionWebhook (terminal hook consumer)", () => {
  it("fires session.failed with the session error and its deep link", () => {
    dbMockState.getQueue.push(
      session({ status: "failed", error: "boom" }),
      { title: "Login feature" }
    );

    sendTerminalSessionWebhook({ sessionId: "s1", status: "failed" });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("p1", {
      event: "session.failed",
      ticketTitle: "Login feature",
      epicId: "e1",
      sessionId: "s1",
      durationMs: 120000,
      error: "boom",
      path: "/projects/p1/sessions/s1",
    });
  });

  it("fires session.completed with the epic and its session deep link", () => {
    dbMockState.getQueue.push(session({ status: "completed" }), {
      title: "Login feature",
    });

    sendTerminalSessionWebhook({ sessionId: "s1", status: "completed" });

    expect(sendMock).toHaveBeenCalledWith("p1", {
      event: "session.completed",
      ticketTitle: "Login feature",
      epicId: "e1",
      sessionId: "s1",
      durationMs: 120000,
      error: null,
      path: "/projects/p1/sessions/s1",
    });
  });

  it("fires session.completed with a QA deep link for a QA session", () => {
    dbMockState.getQueue.push(
      session({ status: "completed", epicId: null, agentType: "tech_check" })
    );

    sendTerminalSessionWebhook({ sessionId: "s1", status: "completed" });

    expect(sendMock).toHaveBeenCalledWith("p1", {
      event: "session.completed",
      ticketTitle: null,
      epicId: null,
      sessionId: "s1",
      durationMs: 120000,
      error: null,
      path: "/projects/p1/qa",
    });
  });

  it("is silent for a cancelled session — a user stop is not an event", () => {
    sendTerminalSessionWebhook({ sessionId: "s3", status: "cancelled" });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never throws into the terminal transition, even when the row is gone", () => {
    expect(() =>
      sendTerminalSessionWebhook({ sessionId: "missing", status: "failed" })
    ).not.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
