import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeQuota, CodexLiveQuota } from "@/lib/types/usage";

// Contract: vitest NEVER spawns a CLI — the fetchers are mocked at the module
// seam and the cache is exercised purely on promise/TTL semantics.

vi.mock("@/lib/usage/claude-quota", () => ({ fetchClaudeQuota: vi.fn() }));
vi.mock("@/lib/usage/codex-appserver", () => ({ fetchCodexLiveQuota: vi.fn() }));
vi.mock("@/lib/usage/codex-snapshot", () => ({ storeCodexLiveSnapshot: vi.fn() }));

import { fetchClaudeQuota } from "@/lib/usage/claude-quota";
import { fetchCodexLiveQuota } from "@/lib/usage/codex-appserver";
import { storeCodexLiveSnapshot } from "@/lib/usage/codex-snapshot";
import {
  QUOTA_TTL_MS,
  __resetQuotaCacheForTests,
  getClaudeQuotaCached,
  getCodexQuotaCached,
} from "@/lib/usage/quota-cache";

const fetchClaudeMock = vi.mocked(fetchClaudeQuota);
const fetchCodexMock = vi.mocked(fetchCodexLiveQuota);
const storeMock = vi.mocked(storeCodexLiveSnapshot);

const CLAUDE_QUOTA: ClaudeQuota = {
  subscriptionType: "max",
  fiveHour: { utilizationPercent: 34, resetsAtIso: "2026-08-18T16:00:00+00:00" },
  sevenDay: { utilizationPercent: 61, resetsAtIso: "2026-08-21T09:00:00+00:00" },
  sevenDayOpus: null,
  sevenDaySonnet: null,
  modelScoped: [],
  extraUsage: null,
};

const CODEX_QUOTA: CodexLiveQuota = {
  planType: "prolite",
  buckets: [
    {
      limitId: "codex",
      limitName: null,
      usedPercent: 6,
      windowDurationMins: 10080,
      resetsAtUnix: 1787671089,
      secondary: null,
    },
  ],
  credits: { hasCredits: false, unlimited: false, balance: "0" },
  dailyUsage: [{ date: "2026-08-18", tokens: 20928692 }],
  lifetimeTokens: 1383498631,
};

beforeEach(() => {
  // The cache lives on globalThis and would otherwise leak across tests
  // within this worker (seam concern pinned in the contract).
  __resetQuotaCacheForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
  fetchClaudeMock.mockReset().mockResolvedValue(null);
  fetchCodexMock.mockReset().mockResolvedValue(null);
  storeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quota cache — TTL semantics", () => {
  it("pins the TTL at 120s", () => {
    expect(QUOTA_TTL_MS).toBe(120_000);
  });

  it("polls once, then serves from cache within the TTL (no second spawn)", async () => {
    fetchClaudeMock.mockResolvedValue(CLAUDE_QUOTA);

    const first = await getClaudeQuotaCached();
    expect(first).toEqual({
      data: CLAUDE_QUOTA,
      capturedAtIso: "2026-08-18T12:00:00.000Z",
    });

    vi.advanceTimersByTime(QUOTA_TTL_MS - 1);
    const second = await getClaudeQuotaCached();
    expect(second).toEqual(first);
    expect(fetchClaudeMock).toHaveBeenCalledTimes(1);
  });

  it("re-polls after the TTL expires", async () => {
    fetchClaudeMock.mockResolvedValue(CLAUDE_QUOTA);
    await getClaudeQuotaCached();

    vi.advanceTimersByTime(QUOTA_TTL_MS);
    await getClaudeQuotaCached();
    expect(fetchClaudeMock).toHaveBeenCalledTimes(2);
  });

  it("caches FAILED attempts too — a missing CLI costs one poll per window", async () => {
    await getClaudeQuotaCached(); // fetch resolves null
    await getClaudeQuotaCached();
    await getClaudeQuotaCached();
    expect(fetchClaudeMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(QUOTA_TTL_MS);
    await getClaudeQuotaCached();
    expect(fetchClaudeMock).toHaveBeenCalledTimes(2);
  });

  it("force bypasses a fresh TTL", async () => {
    fetchClaudeMock.mockResolvedValue(CLAUDE_QUOTA);
    await getClaudeQuotaCached();
    await getClaudeQuotaCached(true);
    expect(fetchClaudeMock).toHaveBeenCalledTimes(2);
  });
});

describe("quota cache — failure state", () => {
  it("returns the null fallback state when the poll fails", async () => {
    expect(await getClaudeQuotaCached()).toEqual({
      data: null,
      capturedAtIso: null,
    });
  });

  it("drops straight to fallback after a failed re-poll — never half-stale live data", async () => {
    fetchClaudeMock.mockResolvedValueOnce(CLAUDE_QUOTA);
    const success = await getClaudeQuotaCached();
    expect(success.data).toEqual(CLAUDE_QUOTA);

    fetchClaudeMock.mockResolvedValueOnce(null);
    vi.advanceTimersByTime(QUOTA_TTL_MS);
    expect(await getClaudeQuotaCached()).toEqual({
      data: null,
      capturedAtIso: null,
    });
  });

  it("never rejects, even when the fetcher itself rejects", async () => {
    fetchClaudeMock.mockRejectedValue(new Error("should never happen"));
    await expect(getClaudeQuotaCached()).resolves.toEqual({
      data: null,
      capturedAtIso: null,
    });
  });
});

describe("quota cache — shared in-flight promise", () => {
  it("concurrent requests share ONE poll (no spawn stampede)", async () => {
    let resolvePoll!: (value: ClaudeQuota) => void;
    fetchClaudeMock.mockReturnValue(
      new Promise<ClaudeQuota | null>((resolve) => {
        resolvePoll = resolve;
      }),
    );

    const a = getClaudeQuotaCached();
    const b = getClaudeQuotaCached();
    resolvePoll(CLAUDE_QUOTA);

    expect(await a).toEqual(await b);
    expect((await a).data).toEqual(CLAUDE_QUOTA);
    expect(fetchClaudeMock).toHaveBeenCalledTimes(1);
  });

  it("force while a flight is up JOINS it — it never starts a second spawn", async () => {
    let resolvePoll!: (value: ClaudeQuota) => void;
    fetchClaudeMock.mockReturnValue(
      new Promise<ClaudeQuota | null>((resolve) => {
        resolvePoll = resolve;
      }),
    );

    const plain = getClaudeQuotaCached();
    const forced = getClaudeQuotaCached(true);
    resolvePoll(CLAUDE_QUOTA);

    expect(await forced).toEqual(await plain);
    expect(fetchClaudeMock).toHaveBeenCalledTimes(1);
  });
});

describe("quota cache — per-provider isolation", () => {
  it("polling claude never touches codex and vice versa", async () => {
    await getClaudeQuotaCached();
    expect(fetchCodexMock).not.toHaveBeenCalled();

    await getCodexQuotaCached();
    expect(fetchClaudeMock).toHaveBeenCalledTimes(1);
    expect(fetchCodexMock).toHaveBeenCalledTimes(1);
  });

  it("a claude failure leaves a codex success untouched", async () => {
    fetchCodexMock.mockResolvedValue({
      quota: CODEX_QUOTA,
      rawRateLimitsJson: "{}",
    });

    const [claude, codex] = await Promise.all([
      getClaudeQuotaCached(),
      getCodexQuotaCached(),
    ]);
    expect(claude.data).toBeNull();
    expect(codex.data).toEqual(CODEX_QUOTA);
  });
});

describe("quota cache — codex snapshot persistence", () => {
  it("upserts the snapshot on every successful codex poll and returns only the quota", async () => {
    fetchCodexMock.mockResolvedValue({
      quota: CODEX_QUOTA,
      rawRateLimitsJson: '{"rateLimits":{"limitId":"codex"}}',
    });

    const cached = await getCodexQuotaCached();
    expect(storeMock).toHaveBeenCalledTimes(1);
    expect(storeMock).toHaveBeenCalledWith(
      CODEX_QUOTA,
      '{"rateLimits":{"limitId":"codex"}}',
    );
    expect(cached).toEqual({
      data: CODEX_QUOTA,
      capturedAtIso: "2026-08-18T12:00:00.000Z",
    });
  });

  it("does not touch the snapshot on a failed poll", async () => {
    await getCodexQuotaCached();
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("keeps the live data even if the store throws (best-effort persistence)", async () => {
    fetchCodexMock.mockResolvedValue({
      quota: CODEX_QUOTA,
      rawRateLimitsJson: "{}",
    });
    storeMock.mockImplementation(() => {
      throw new Error("db locked");
    });

    const cached = await getCodexQuotaCached();
    expect(cached.data).toEqual(CODEX_QUOTA);
  });
});
