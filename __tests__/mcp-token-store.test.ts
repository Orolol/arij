/**
 * Lifecycle tests for lib/mcp/token-store.ts — mint/resolve/revoke,
 * the askedQuestion flag, and the revocation-keyed purge.
 *
 * Two behaviors everything downstream depends on:
 *   1. Revocation invalidates auth but KEEPS the record, because the
 *      process-manager completion handler revokes tokens before the dispatch
 *      routes run outcome classification, and `wasQuestionAskedViaMcp` must
 *      still read the flag at that point.
 *   2. The purge NEVER touches a live (unrevoked) record. A session running
 *      longer than any fixed mint-time TTL would otherwise lose its auth —
 *      and its askedQuestion flag — mid-run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetMcpTokenStoreForTests,
  markQuestionAsked,
  mintMcpToken,
  purgeExpiredMcpTokens,
  resolveMcpToken,
  revokeMcpTokensForSession,
  REVOKED_TOKEN_GRACE_MS,
  wasQuestionAskedViaMcp,
} from "@/lib/mcp/token-store";

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  _resetMcpTokenStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mintMcpToken / resolveMcpToken", () => {
  it("mints an arij-mcp- prefixed token that resolves to the full context", () => {
    const token = mintMcpToken({
      sessionId: "sess-1",
      projectId: "proj-1",
      epicId: "epic-1",
      userStoryId: "story-1",
      agentType: "builder",
    });

    expect(token.startsWith("arij-mcp-")).toBe(true);
    // Two createId() calls (12 chars each) of URL-safe randomness.
    expect(token.slice("arij-mcp-".length)).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const record = resolveMcpToken(token);
    expect(record).toMatchObject({
      token,
      sessionId: "sess-1",
      projectId: "proj-1",
      epicId: "epic-1",
      userStoryId: "story-1",
      agentType: "builder",
      revokedAt: null,
      askedQuestion: false,
    });
    expect(typeof record?.createdAt).toBe("number");
  });

  it("defaults optional context fields to null", () => {
    const token = mintMcpToken({ sessionId: "sess-1", projectId: "proj-1" });

    expect(resolveMcpToken(token)).toMatchObject({
      epicId: null,
      userStoryId: null,
      agentType: null,
    });
  });

  it("mints unique tokens across calls", () => {
    const a = mintMcpToken({ sessionId: "sess-1", projectId: "proj-1" });
    const b = mintMcpToken({ sessionId: "sess-1", projectId: "proj-1" });
    expect(a).not.toBe(b);
  });

  it("returns null for unknown tokens", () => {
    expect(resolveMcpToken("arij-mcp-nope")).toBeNull();
  });
});

describe("revokeMcpTokensForSession", () => {
  it("invalidates every token of the session but leaves other sessions live", () => {
    const a1 = mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });
    const a2 = mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });
    const b = mintMcpToken({ sessionId: "sess-b", projectId: "proj-1" });

    revokeMcpTokensForSession("sess-a");

    expect(resolveMcpToken(a1)).toBeNull();
    expect(resolveMcpToken(a2)).toBeNull();
    expect(resolveMcpToken(b)).not.toBeNull();
  });

  it("keeps the record: askedQuestion stays readable after revocation", () => {
    const token = mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });
    markQuestionAsked("sess-a");

    revokeMcpTokensForSession("sess-a");

    // Auth is dead…
    expect(resolveMcpToken(token)).toBeNull();
    // …but the classification-critical flag survives (revoke ≠ delete).
    expect(wasQuestionAskedViaMcp("sess-a")).toBe(true);
  });

  it("is a no-op for sessions without tokens", () => {
    expect(() => revokeMcpTokensForSession("sess-none")).not.toThrow();
  });
});

describe("markQuestionAsked / wasQuestionAskedViaMcp", () => {
  it("returns false before any mark, true after", () => {
    mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });

    expect(wasQuestionAskedViaMcp("sess-a")).toBe(false);
    expect(markQuestionAsked("sess-a")).toBe(true);
    expect(wasQuestionAskedViaMcp("sess-a")).toBe(true);
  });

  it("returns false when the session has no records", () => {
    expect(markQuestionAsked("sess-unknown")).toBe(false);
    expect(wasQuestionAskedViaMcp("sess-unknown")).toBe(false);
  });

  it("does not leak the flag to other sessions", () => {
    mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });
    mintMcpToken({ sessionId: "sess-b", projectId: "proj-1" });

    markQuestionAsked("sess-a");

    expect(wasQuestionAskedViaMcp("sess-b")).toBe(false);
  });
});

describe("purgeExpiredMcpTokens", () => {
  it("uses a one-hour grace period keyed on revocation time", () => {
    expect(REVOKED_TOKEN_GRACE_MS).toBe(HOUR_MS);
  });

  it("keeps a revoked record up to exactly the grace period, drops it after", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T10:00:00.000Z"));
    const token = mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });
    markQuestionAsked("sess-a");

    revokeMcpTokensForSession("sess-a");
    const revoked = Date.now();

    // …the flag stays readable for classification during the grace window
    expect(purgeExpiredMcpTokens(revoked + REVOKED_TOKEN_GRACE_MS)).toBe(0);
    expect(wasQuestionAskedViaMcp("sess-a")).toBe(true);

    expect(purgeExpiredMcpTokens(revoked + REVOKED_TOKEN_GRACE_MS + 1)).toBe(1);
    expect(resolveMcpToken(token)).toBeNull();
    expect(wasQuestionAskedViaMcp("sess-a")).toBe(false);
  });

  it("NEVER purges a live token, however long the session has been running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T10:00:00.000Z"));
    const minted = Date.now();
    const token = mintMcpToken({ sessionId: "sess-marathon", projectId: "proj-1" });
    markQuestionAsked("sess-marathon");

    // 30 days into a still-running session — well past any mint-time TTL
    expect(purgeExpiredMcpTokens(minted + 30 * 24 * HOUR_MS)).toBe(0);

    // auth still works and the flag survives
    expect(resolveMcpToken(token)).not.toBeNull();
    expect(resolveMcpToken(token)!.sessionId).toBe("sess-marathon");
    expect(wasQuestionAskedViaMcp("sess-marathon")).toBe(true);
  });

  it("is invoked by mint: only long-revoked records vanish, live ones stay", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T10:00:00.000Z"));
    const done = mintMcpToken({ sessionId: "sess-done", projectId: "proj-1" });
    const running = mintMcpToken({ sessionId: "sess-running", projectId: "proj-1" });
    markQuestionAsked("sess-done");
    revokeMcpTokensForSession("sess-done");

    vi.setSystemTime(new Date("2026-08-19T10:00:00.000Z")); // +48h
    const fresh = mintMcpToken({ sessionId: "sess-new", projectId: "proj-1" });

    // revoked long ago → gone
    expect(resolveMcpToken(done)).toBeNull();
    expect(wasQuestionAskedViaMcp("sess-done")).toBe(false);
    // never revoked → still live despite being 48h old
    expect(resolveMcpToken(running)).not.toBeNull();
    expect(resolveMcpToken(fresh)).not.toBeNull();
  });

  it("keeps a just-revoked record so classification can still read the flag", () => {
    const token = mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });
    markQuestionAsked("sess-a");
    revokeMcpTokensForSession("sess-a");

    // a concurrent mint runs the purge — the record must survive it
    mintMcpToken({ sessionId: "sess-b", projectId: "proj-1" });

    expect(resolveMcpToken(token)).toBeNull(); // auth dead
    expect(wasQuestionAskedViaMcp("sess-a")).toBe(true); // record alive
  });
});

describe("_resetMcpTokenStoreForTests", () => {
  it("clears everything", () => {
    const token = mintMcpToken({ sessionId: "sess-a", projectId: "proj-1" });
    markQuestionAsked("sess-a");

    _resetMcpTokenStoreForTests();

    expect(resolveMcpToken(token)).toBeNull();
    expect(wasQuestionAskedViaMcp("sess-a")).toBe(false);
  });
});
