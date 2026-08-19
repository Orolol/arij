/**
 * The shared session-continuity capability lists.
 *
 * These used to be copy-pasted inline in six dispatch routes, which is how
 * Pi ended up declared resumable while every route still hardcoded
 * Claude/Gemini/Codex. These tests pin the three questions apart.
 */
import { describe, expect, it } from "vitest";
import {
  isResumableProvider,
  providerAcceptsAssignedSessionId,
  providerReportsOwnSessionId,
} from "@/lib/agent-sessions/resume-capability";
import { PROVIDER_OPTIONS } from "@/lib/agent-config/constants";

describe("isResumableProvider", () => {
  it("accepts every provider whose CLI can continue a session", () => {
    for (const provider of [
      "claude-code",
      "gemini-cli",
      "mistral-vibe",
      "opencode",
      "kimi",
      "pi",
      "oh-my-pi",
    ]) {
      expect(isResumableProvider(provider), provider).toBe(true);
    }
  });

  it("rejects providers with no usable resume handle", () => {
    for (const provider of ["codex", "qwen-code", "deepseek", "zai"]) {
      expect(isResumableProvider(provider), provider).toBe(false);
    }
  });

  it("rejects unknown values", () => {
    expect(isResumableProvider("nonexistent")).toBe(false);
    expect(isResumableProvider("")).toBe(false);
  });

  it("classifies every known provider one way or the other", () => {
    for (const provider of PROVIDER_OPTIONS) {
      expect(typeof isResumableProvider(provider), provider).toBe("boolean");
    }
  });
});

describe("providerReportsOwnSessionId", () => {
  it("is true only for the pi family, which prints its session header", () => {
    expect(providerReportsOwnSessionId("pi")).toBe(true);
    expect(providerReportsOwnSessionId("oh-my-pi")).toBe(true);
  });

  it("is false for providers dispatch has to name itself", () => {
    for (const provider of ["claude-code", "gemini-cli", "codex", "opencode"]) {
      expect(providerReportsOwnSessionId(provider), provider).toBe(false);
    }
  });
});

describe("providerAcceptsAssignedSessionId", () => {
  it("covers the providers routes pre-assign a UUID for", () => {
    expect(providerAcceptsAssignedSessionId("claude-code")).toBe(true);
    expect(providerAcceptsAssignedSessionId("gemini-cli")).toBe(true);
    expect(providerAcceptsAssignedSessionId("codex")).toBe(true);
  });

  /**
   * The two questions must stay distinct: pi can resume, but assigning it an
   * id would persist one the CLI never used and replay it into --session.
   */
  it("never pre-assigns an id to a provider that reports its own", () => {
    for (const provider of PROVIDER_OPTIONS) {
      if (providerReportsOwnSessionId(provider)) {
        expect(providerAcceptsAssignedSessionId(provider), provider).toBe(false);
      }
    }
    expect(providerAcceptsAssignedSessionId("pi")).toBe(false);
    expect(providerAcceptsAssignedSessionId("oh-my-pi")).toBe(false);
  });
});
