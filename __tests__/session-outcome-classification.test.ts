/**
 * Delivery-verdict classification matrix.
 *
 * `classifySessionOutcome` is the single choke point every dispatch route
 * threads through `markSessionTerminal` — each case below mirrors a realistic
 * provider result shape.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock backs the
// lastNonEmptyText lookup.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const { classifySessionOutcome } = await import(
  "@/lib/claude/resolve-session-output"
);

beforeEach(() => {
  resetDbMockState();
});

describe("classifySessionOutcome", () => {
  it("classifies a failed CLI run as error", () => {
    const result = {
      success: false,
      error: "Claude CLI exited with code 1",
      duration: 1200,
    };
    expect(classifySessionOutcome(result, "s-err")).toBe("error");
  });

  it("classifies a lost/missing result as error", () => {
    expect(classifySessionOutcome(undefined, "s-missing")).toBe("error");
    expect(classifySessionOutcome(null, "s-missing-2")).toBe("error");
  });

  it("classifies error over asked_question when the run failed", () => {
    const result = {
      success: false,
      error: "Process was cancelled.",
      endedWithQuestion: true,
      duration: 900,
    };
    expect(classifySessionOutcome(result, "s-failed-q")).toBe("error");
  });

  it("classifies a successful run that ended with AskUserQuestion as asked_question", () => {
    const result = {
      success: true,
      result: JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Should I use OAuth or magic links for authentication?",
        session_id: "cli-123",
      }),
      endedWithQuestion: true,
      duration: 42000,
    };
    expect(classifySessionOutcome(result, "s-question")).toBe("asked_question");
  });

  it("classifies a successful run with textual output as answered", () => {
    const result = {
      success: true,
      result: JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Implemented the login flow; all 12 tests pass.",
      }),
      duration: 60000,
    };
    expect(classifySessionOutcome(result, "s-answered")).toBe("answered");
  });

  it("classifies plain-text (non-JSON) output as answered", () => {
    const result = {
      success: true,
      result: "Done. Changed 3 files.",
      duration: 5000,
    };
    expect(classifySessionOutcome(result, "s-plain")).toBe("answered");
  });

  it("classifies an empty result envelope with no streamed text as silent", () => {
    const result = {
      success: true,
      // Tool-call-only session: envelope carries no final text.
      result: JSON.stringify({
        type: "result",
        subtype: "success",
        result: "",
        session_id: "cli-456",
      }),
      duration: 30000,
    };
    dbMockState.getQueue = [null]; // no lastNonEmptyText row
    expect(classifySessionOutcome(result, "s-silent")).toBe("silent");
  });

  it("classifies a missing result payload with no streamed text as silent", () => {
    const result = { success: true, duration: 100 };
    dbMockState.getQueue = [{ lastNonEmptyText: null }];
    expect(classifySessionOutcome(result, "s-silent-2")).toBe("silent");
  });

  it("prefers streamed lastNonEmptyText over silent for chunked providers", () => {
    const result = {
      success: true,
      result: JSON.stringify({
        type: "result",
        subtype: "success",
        result: "",
      }),
      duration: 30000,
    };
    dbMockState.getQueue = [
      { lastNonEmptyText: "Applied 3 file edits and ran the tests." },
    ];
    expect(classifySessionOutcome(result, "s-streamed")).toBe("answered");
  });

  it("treats question detection as stronger than textual output", () => {
    // A question plus explanatory text is still a blocked deliverable.
    const result = {
      success: true,
      result: JSON.stringify({
        type: "result",
        subtype: "success",
        result: "I need input before continuing. Which database should I target?",
      }),
      endedWithQuestion: true,
      duration: 15000,
    };
    expect(classifySessionOutcome(result, "s-question-text")).toBe(
      "asked_question"
    );
  });
});
