import { describe, it, expect } from "vitest";
import {
  selectLatestFailures,
  type FailureCandidateSession,
} from "@/lib/agent-sessions/latest-failure";

function session(overrides: Partial<FailureCandidateSession>): FailureCandidateSession {
  return {
    id: "s",
    kind: "agent_session",
    status: "completed",
    epicId: "e1",
    createdAt: "2026-08-21 10:00:00",
    ...overrides,
  };
}

describe("selectLatestFailures", () => {
  it("badges an epic whose latest session is failed", () => {
    const failed = selectLatestFailures(
      [
        session({ id: "old", status: "completed", createdAt: "2026-08-21 09:59:00" }),
        session({ id: "f1", status: "failed", error: "boom", agentType: "build" }),
      ],
      new Set()
    );
    expect(failed).toEqual({
      e1: { sessionId: "f1", error: "boom", agentType: "build" },
    });
  });

  it("clears the badge as soon as a retry is queued or running", () => {
    for (const status of ["queued", "running"]) {
      const failed = selectLatestFailures(
        [
          session({ id: "f1", status: "failed", error: "boom" }),
          session({ id: "retry", status, createdAt: "2026-08-21 10:05:00" }),
        ],
        new Set()
      );
      expect(failed).toEqual({});
    }
  });

  it("does not resurrect the badge after a retry completes", () => {
    const failed = selectLatestFailures(
      [
        session({ id: "f1", status: "failed", error: "boom" }),
        session({ id: "retry", status: "completed", createdAt: "2026-08-21 10:05:00" }),
      ],
      new Set()
    );
    expect(failed).toEqual({});
  });

  it("shows the NEW session's error after a retry fails again", () => {
    const failed = selectLatestFailures(
      [
        session({
          id: "f1",
          status: "failed",
          error: "first failure",
          endedAt: "2026-08-21 10:00:30",
        }),
        session({
          id: "retry",
          status: "failed",
          error: "second failure",
          agentType: "review",
          createdAt: "2026-08-21 10:05:00",
          endedAt: "2026-08-21 10:09:00",
        }),
      ],
      new Set()
    );
    expect(failed).toEqual({
      e1: { sessionId: "retry", error: "second failure", agentType: "review" },
    });
  });

  it("breaks a same-second failed+completed tie in favor of clearing the badge", () => {
    const failed = selectLatestFailures(
      [
        session({ id: "f1", status: "failed", error: "boom" }),
        session({ id: "retry", status: "completed" }),
      ],
      new Set()
    );
    expect(failed).toEqual({});
  });

  it("breaks a same-second all-failed tie by latest endedAt", () => {
    const failed = selectLatestFailures(
      [
        session({
          id: "f1",
          status: "failed",
          error: "first failure",
          endedAt: "2026-08-21 10:00:30",
        }),
        session({
          id: "retry",
          status: "failed",
          error: "second failure",
          endedAt: "2026-08-21 10:00:59",
        }),
      ],
      new Set()
    );
    expect(failed.e1?.sessionId).toBe("retry");
  });

  it("keeps the registry guard: active epics are never badged", () => {
    const failed = selectLatestFailures(
      [session({ id: "f1", status: "failed", error: "boom" })],
      new Set(["e1"])
    );
    expect(failed).toEqual({});
  });

  it("ignores chat conversations and sessions without an epic", () => {
    const failed = selectLatestFailures(
      [
        session({ id: "c1", kind: "chat_session", status: "failed", error: "boom" }),
        session({ id: "f1", status: "failed", error: "boom", epicId: null }),
      ],
      new Set()
    );
    expect(failed).toEqual({});
  });

  it("defaults missing error to a readable message", () => {
    const failed = selectLatestFailures(
      [session({ id: "f1", status: "failed", error: null })],
      new Set()
    );
    expect(failed.e1?.error).toBe("Unknown error");
    expect(failed.e1?.agentType).toBe("build");
  });
});
