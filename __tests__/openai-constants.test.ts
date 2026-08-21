import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENAI_REASONING_EFFORT,
  OPENAI_REASONING_EFFORTS,
  parseOpenAiReasoningEffort,
} from "@/lib/openai/constants";

describe("OpenAI-compatible constants", () => {
  it("exposes the off/low/medium/high reasoning efforts with off as default", () => {
    expect(OPENAI_REASONING_EFFORTS).toEqual(["off", "low", "medium", "high"]);
    expect(DEFAULT_OPENAI_REASONING_EFFORT).toBe("off");
  });

  it("parseOpenAiReasoningEffort accepts every known effort value", () => {
    for (const effort of OPENAI_REASONING_EFFORTS) {
      expect(parseOpenAiReasoningEffort(effort)).toBe(effort);
    }
  });

  it("parseOpenAiReasoningEffort defaults to off for unknown or missing values", () => {
    expect(parseOpenAiReasoningEffort(undefined)).toBe("off");
    expect(parseOpenAiReasoningEffort("")).toBe("off");
    expect(parseOpenAiReasoningEffort("turbo")).toBe("off");
    expect(parseOpenAiReasoningEffort("MEDIUM")).toBe("off");
    expect(parseOpenAiReasoningEffort(42)).toBe("off");
    expect(parseOpenAiReasoningEffort(null)).toBe("off");
  });
});
