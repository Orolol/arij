import { describe, it, expect, vi } from "vitest";

// The lifecycle module imports @/lib/db for its DB-backed helpers; the pure
// state-machine functions under test here do not need a real database.
vi.mock("@/lib/db", () => ({
  db: {},
}));

import {
  isValidSessionTransition,
  assertValidSessionTransition,
  isTerminalSessionStatus,
  SessionLifecycleConflictError,
  type AgentSessionLifecycleStatus,
} from "@/lib/agent-sessions/lifecycle";

describe("Session Status Machine (merged into lifecycle)", () => {
  describe("isValidSessionTransition()", () => {
    it("allows queued -> running", () => {
      expect(isValidSessionTransition("queued", "running")).toBe(true);
    });

    it("allows queued -> cancelled", () => {
      expect(isValidSessionTransition("queued", "cancelled")).toBe(true);
    });

    it("allows queued -> failed", () => {
      expect(isValidSessionTransition("queued", "failed")).toBe(true);
    });

    it("allows running -> completed", () => {
      expect(isValidSessionTransition("running", "completed")).toBe(true);
    });

    it("allows running -> failed", () => {
      expect(isValidSessionTransition("running", "failed")).toBe(true);
    });

    it("allows running -> cancelled", () => {
      expect(isValidSessionTransition("running", "cancelled")).toBe(true);
    });

    it("rejects completed -> running (terminal state)", () => {
      expect(isValidSessionTransition("completed", "running")).toBe(false);
    });

    it("rejects completed -> failed (terminal state)", () => {
      expect(isValidSessionTransition("completed", "failed")).toBe(false);
    });

    it("rejects failed -> running (terminal state)", () => {
      expect(isValidSessionTransition("failed", "running")).toBe(false);
    });

    it("rejects failed -> completed (terminal state)", () => {
      expect(isValidSessionTransition("failed", "completed")).toBe(false);
    });

    it("rejects cancelled -> running (terminal state)", () => {
      expect(isValidSessionTransition("cancelled", "running")).toBe(false);
    });

    it("rejects cancelled -> completed (terminal state)", () => {
      expect(isValidSessionTransition("cancelled", "completed")).toBe(false);
    });

    it("rejects running -> queued (no backward transition)", () => {
      expect(isValidSessionTransition("running", "queued")).toBe(false);
    });

    it("rejects same-state transitions (completed -> completed)", () => {
      expect(isValidSessionTransition("completed", "completed")).toBe(false);
    });

    it("rejects queued -> completed (must go through running)", () => {
      expect(isValidSessionTransition("queued", "completed")).toBe(false);
    });
  });

  describe("assertValidSessionTransition()", () => {
    it("returns target status for valid transitions", () => {
      expect(assertValidSessionTransition("s1", "running", "completed")).toBe(
        "completed"
      );
    });

    it("throws a lifecycle conflict error for invalid transitions", () => {
      expect(() =>
        assertValidSessionTransition("s2", "completed", "running")
      ).toThrow(SessionLifecycleConflictError);

      try {
        assertValidSessionTransition("s2", "completed", "running");
        throw new Error("Expected lifecycle conflict");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionLifecycleConflictError);
        const conflict = error as SessionLifecycleConflictError;
        expect(conflict.details).toMatchObject({
          sessionId: "s2",
          fromStatus: "completed",
          toStatus: "running",
        });
      }
    });
  });

  describe("isTerminalSessionStatus()", () => {
    it("completed is terminal", () => {
      expect(isTerminalSessionStatus("completed")).toBe(true);
    });

    it("failed is terminal", () => {
      expect(isTerminalSessionStatus("failed")).toBe(true);
    });

    it("cancelled is terminal", () => {
      expect(isTerminalSessionStatus("cancelled")).toBe(true);
    });

    it("queued is not terminal", () => {
      expect(isTerminalSessionStatus("queued")).toBe(false);
    });

    it("running is not terminal", () => {
      expect(isTerminalSessionStatus("running")).toBe(false);
    });
  });

  describe("exhaustive transition coverage", () => {
    const allStatuses: AgentSessionLifecycleStatus[] = [
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
    ];

    it("terminal states have no valid outgoing transitions", () => {
      for (const terminal of [
        "completed",
        "failed",
        "cancelled",
      ] as AgentSessionLifecycleStatus[]) {
        for (const target of allStatuses) {
          expect(isValidSessionTransition(terminal, target)).toBe(false);
        }
      }
    });

    it("queued can only transition to running, cancelled, or failed", () => {
      const allowed = new Set<AgentSessionLifecycleStatus>([
        "running",
        "cancelled",
        "failed",
      ]);
      for (const target of allStatuses) {
        expect(isValidSessionTransition("queued", target)).toBe(
          allowed.has(target)
        );
      }
    });

    it("running can only transition to completed, failed, or cancelled", () => {
      const allowed = new Set<AgentSessionLifecycleStatus>([
        "completed",
        "failed",
        "cancelled",
      ]);
      for (const target of allStatuses) {
        expect(isValidSessionTransition("running", target)).toBe(
          allowed.has(target)
        );
      }
    });
  });
});
