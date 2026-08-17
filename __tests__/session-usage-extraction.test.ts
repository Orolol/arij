/**
 * Unit tests for token/cost usage extraction:
 *   - extractUsageFromOutput parses the Claude CLI result envelope (one-shot
 *     JSON and stream-json NDJSON) and never fabricates numbers,
 *   - extractSessionUsage maps a ClaudeResult onto the optional usage field
 *     threaded through markSessionTerminal.
 */
import { describe, expect, it, vi } from "vitest";
import { extractUsageFromOutput } from "@/lib/claude/json-parser";

// resolve-session-output imports @/lib/db for its lastNonEmptyText fallback;
// the usage helpers never touch the DB but the module mock keeps the import
// side-effect-free.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const { extractSessionUsage } = await import(
  "@/lib/claude/resolve-session-output"
);

const FULL_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 7893,
  result: "All done.",
  session_id: "abc-123",
  total_cost_usd: 0.084,
  usage: {
    input_tokens: 4,
    cache_creation_input_tokens: 15188,
    cache_read_input_tokens: 14063,
    output_tokens: 260,
  },
});

describe("extractUsageFromOutput", () => {
  it("parses the one-shot result envelope, summing cache tokens into inputTokens", () => {
    expect(extractUsageFromOutput(FULL_ENVELOPE)).toEqual({
      totalCostUsd: 0.084,
      inputTokens: 4 + 15188 + 14063,
      outputTokens: 260,
    });
  });

  it("captures cost alone when the envelope has no usage object", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "ok",
      total_cost_usd: 0.01,
    });
    expect(extractUsageFromOutput(raw)).toEqual({ totalCostUsd: 0.01 });
  });

  it("captures partial usage without fabricating missing fields", () => {
    const raw = JSON.stringify({
      type: "result",
      usage: { output_tokens: 42 },
    });
    expect(extractUsageFromOutput(raw)).toEqual({ outputTokens: 42 });
  });

  it("uses the last usage-carrying line of stream-json output", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        // Per-message usage nested in the message is intentionally ignored.
        message: { usage: { input_tokens: 999999, output_tokens: 999999 } },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        total_cost_usd: 0.5,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ].join("\n");

    expect(extractUsageFromOutput(ndjson)).toEqual({
      totalCostUsd: 0.5,
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it("returns null for plain-text provider output", () => {
    expect(extractUsageFromOutput("I refactored the module as asked.")).toBeNull();
    expect(extractUsageFromOutput("")).toBeNull();
  });

  it("ignores non-numeric fields instead of coercing them", () => {
    const raw = JSON.stringify({
      type: "result",
      total_cost_usd: "0.5",
      usage: { input_tokens: "12", output_tokens: null },
    });
    expect(extractUsageFromOutput(raw)).toBeNull();
  });

  it("does not invent zeros for envelopes without any usage", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "done",
      session_id: "s-1",
    });
    expect(extractUsageFromOutput(raw)).toBeNull();
  });
});

describe("extractSessionUsage", () => {
  it("maps a successful claude-code result onto SessionUsage", () => {
    const usage = extractSessionUsage({
      success: true,
      result: FULL_ENVELOPE,
      duration: 7893,
    });
    expect(usage).toEqual({
      totalCostUsd: 0.084,
      inputTokens: 29255,
      outputTokens: 260,
    });
  });

  it("still extracts usage from failed runs that kept their raw envelope", () => {
    const usage = extractSessionUsage({
      success: false,
      error: "claude CLI exited with code 1",
      result: JSON.stringify({
        type: "result",
        subtype: "error",
        is_error: true,
        total_cost_usd: 0.02,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      duration: 1200,
    });
    expect(usage).toEqual({
      totalCostUsd: 0.02,
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it("returns undefined for text-only provider results and missing results", () => {
    expect(
      extractSessionUsage({
        success: true,
        result: "Refactored 3 files.",
        duration: 900,
      }),
    ).toBeUndefined();
    expect(extractSessionUsage(null)).toBeUndefined();
    expect(extractSessionUsage(undefined)).toBeUndefined();
    expect(
      extractSessionUsage({ success: false, error: "boom", duration: 10 }),
    ).toBeUndefined();
  });
});
