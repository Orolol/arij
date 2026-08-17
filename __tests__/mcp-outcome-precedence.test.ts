/**
 * MCP-flag precedence in the delivery-verdict classifier.
 *
 * `classifySessionOutcome` order is: error > MCP ask_question flag > prose
 * heuristic (`endedWithQuestion`) > answered/silent. The flag is read from
 * the REAL token store (globalThis singleton) — these tests exercise the
 * exact plumbing production uses: mint at spawn, markQuestionAsked from the
 * /api/mcp/ask-question route, revoke from the process-manager completion
 * handler, classify from the dispatch route.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock backs the
// lastNonEmptyText lookup inside resolve-session-output.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const { classifySessionOutcome } = await import(
  "@/lib/claude/resolve-session-output"
);
const {
  mintMcpToken,
  markQuestionAsked,
  revokeMcpTokensForSession,
  _resetMcpTokenStoreForTests,
} = await import("@/lib/mcp/token-store");

function flagSession(sessionId: string): void {
  mintMcpToken({ sessionId, projectId: "p-1", epicId: "e-1" });
  markQuestionAsked(sessionId);
}

const answeredResult = {
  success: true,
  result: JSON.stringify({
    type: "result",
    subtype: "success",
    result: "Implemented the endpoint; tests pass.",
  }),
  duration: 1000,
};

beforeEach(() => {
  resetDbMockState();
  _resetMcpTokenStoreForTests();
});

describe("classifySessionOutcome — MCP ask_question flag", () => {
  it("classifies a successful run as asked_question when the flag is set, even with textual output", () => {
    flagSession("s-mcp-q");
    expect(classifySessionOutcome(answeredResult, "s-mcp-q")).toBe(
      "asked_question"
    );
  });

  it("keeps error precedence: a failed run stays error even if it asked via MCP first", () => {
    flagSession("s-mcp-fail");
    const result = {
      success: false,
      error: "Claude CLI exited with code 1",
      duration: 500,
    };
    expect(classifySessionOutcome(result, "s-mcp-fail")).toBe("error");
  });

  it("beats the silent verdict: a tool-call-only session that asked via MCP is asked_question", () => {
    flagSession("s-mcp-silent");
    const result = {
      success: true,
      result: JSON.stringify({ type: "result", subtype: "success", result: "" }),
      duration: 800,
    };
    // No lastNonEmptyText row either — without the flag this would be silent.
    dbMockState.getQueue = [null];
    expect(classifySessionOutcome(result, "s-mcp-silent")).toBe(
      "asked_question"
    );
  });

  it("survives token revocation (process-manager revokes before routes classify)", () => {
    flagSession("s-mcp-revoked");
    revokeMcpTokensForSession("s-mcp-revoked");
    expect(classifySessionOutcome(answeredResult, "s-mcp-revoked")).toBe(
      "asked_question"
    );
  });

  it("does not leak across sessions", () => {
    flagSession("s-other");
    expect(classifySessionOutcome(answeredResult, "s-clean")).toBe("answered");
  });

  it("falls back to the prose heuristic when the flag is absent", () => {
    const result = {
      ...answeredResult,
      endedWithQuestion: true,
    };
    expect(classifySessionOutcome(result, "s-prose-q")).toBe("asked_question");
  });

  it("classifies answered when neither flag nor prose heuristic fire", () => {
    // Minted but never asked — injection alone must not change the verdict.
    mintMcpToken({ sessionId: "s-injected", projectId: "p-1" });
    expect(classifySessionOutcome(answeredResult, "s-injected")).toBe(
      "answered"
    );
  });
});
