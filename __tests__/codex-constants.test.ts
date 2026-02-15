import { describe, it, expect } from "vitest";
import { CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS } from "@/lib/codex/constants";

describe("CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS", () => {
  it("is a non-empty string", () => {
    expect(typeof CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS).toBe("string");
    expect(CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS.trim().length).toBeGreaterThan(0);
  });

  it("mentions sub-agents or delegation", () => {
    const lower = CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS.toLowerCase();
    expect(
      lower.includes("sub-agent") ||
        lower.includes("subagent") ||
        lower.includes("delegate") ||
        lower.includes("task tool")
    ).toBe(true);
  });
});
