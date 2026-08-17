/**
 * Autonomous pipeline — forensic prompt content matrix.
 *
 * `buildForensicPrompt` is pure (no db, no fs), so the whole matrix is
 * asserted directly: the facts block, every evidence block in both its
 * present and missing form, and the diagnose-only instructions.
 */
import { describe, it, expect } from "vitest";
import {
  buildForensicPrompt,
  FORENSIC_MAX_WORDS,
  type ForensicPromptInput,
} from "@/lib/pipeline/forensic-prompt";

function input(
  overrides: Partial<ForensicPromptInput> = {}
): ForensicPromptInput {
  return {
    project: { name: "Arij", description: null, memory: null },
    ticketTitle: "Checkout flow",
    stage: "build",
    attempts: 2,
    provider: "claude-code",
    model: "sonnet",
    error: null,
    rawTail: null,
    outputTail: null,
    lastText: null,
    ...overrides,
  };
}

describe("buildForensicPrompt — facts block", () => {
  it("states ticket, stage, attempts, provider and model", () => {
    const prompt = buildForensicPrompt(input());

    expect(prompt).toContain("# Project: Arij");
    expect(prompt).toContain("## Failed Agent Session");
    expect(prompt).toContain("- **Ticket:** Checkout flow");
    expect(prompt).toContain("- **Pipeline stage:** build");
    expect(prompt).toContain("- **Attempts before giving up:** 2");
    expect(prompt).toContain("- **Provider:** claude-code");
    expect(prompt).toContain("- **Model:** sonnet");
  });

  it("falls back to explicit placeholders for unknown ticket/provider/model", () => {
    const prompt = buildForensicPrompt(
      input({ ticketTitle: null, provider: null, model: null, stage: "review" })
    );

    expect(prompt).toContain("- **Ticket:** (unknown ticket)");
    expect(prompt).toContain("- **Provider:** (unknown)");
    expect(prompt).toContain("- **Model:** (provider default)");
    expect(prompt).toContain("- **Pipeline stage:** review");
  });

  it("injects the system prompt, description and project memory when present", () => {
    const prompt = buildForensicPrompt(
      input({
        project: {
          name: "Arij",
          description: "Local AI orchestrator",
          memory: "- Never run drizzle-kit generate",
        },
        systemPrompt: "You are a forensic analyst.",
      })
    );

    expect(prompt).toContain("# System Instructions");
    expect(prompt).toContain("You are a forensic analyst.");
    expect(prompt).toContain("Local AI orchestrator");
    expect(prompt).toContain("- Never run drizzle-kit generate");
  });

  it("omits the memory and system sections when they are empty", () => {
    const prompt = buildForensicPrompt(input({ systemPrompt: "  " }));

    expect(prompt).not.toContain("# System Instructions");
    expect(prompt).not.toContain("Project memory");
  });
});

describe("buildForensicPrompt — evidence blocks", () => {
  it("fences each piece of evidence it was given", () => {
    const prompt = buildForensicPrompt(
      input({
        error: "Command failed with exit code 1",
        rawTail: "npm ERR! ELIFECYCLE",
        outputTail: "Running tests...",
        lastText: "I could not find the module",
      })
    );

    expect(prompt).toContain("### Recorded error\n\n```\nCommand failed with exit code 1\n```");
    expect(prompt).toContain("### Raw stream (tail)\n\n```\nnpm ERR! ELIFECYCLE\n```");
    expect(prompt).toContain("### Output stream (tail)\n\n```\nRunning tests...\n```");
    expect(prompt).toContain("### Last text produced\n\n```\nI could not find the module\n```");
  });

  it("renders every missing or blank piece of evidence as (none)", () => {
    const prompt = buildForensicPrompt(
      input({ error: "   ", rawTail: "", outputTail: null, lastText: null })
    );

    expect(prompt).toContain("### Recorded error\n\n(none)");
    expect(prompt).toContain("### Raw stream (tail)\n\n(none)");
    expect(prompt).toContain("### Output stream (tail)\n\n(none)");
    expect(prompt).toContain("### Last text produced\n\n(none)");
    // A session that produced nothing at all still gets a full prompt.
    expect(prompt).toContain("## Evidence");
    expect(prompt).toContain("## Task: Diagnose the Failure");
  });
});

describe("buildForensicPrompt — instructions", () => {
  it("asks for a short, diagnose-only, question-free report in three sections", () => {
    const prompt = buildForensicPrompt(input({ stage: "fix", attempts: 3 }));

    expect(prompt).toContain("after the `fix` stage failed 3 time(s)");
    expect(prompt).toContain("DIAGNOSE ONLY");
    expect(prompt).toContain("do not commit");
    expect(prompt).toContain("Do NOT ask the user a question");
    expect(prompt).toContain(`HARD LIMIT: ${FORENSIC_MAX_WORDS} words`);
    expect(prompt).toContain("**Probable root cause**");
    expect(prompt).toContain("**Evidence**");
    expect(prompt).toContain("**Recommended next action**");
  });
});
