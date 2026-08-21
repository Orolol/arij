import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";

const testDb = vi.hoisted(() => ({
  instance: null as ReturnType<
    typeof import("@/lib/db/test-utils").createTestDb
  > | null,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.db;
  },
  get sqlite() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.sqlite;
  },
}));

// ---- Import the module under test AFTER mocks ----
import { getUsageReport, type LiveQuotaInputs } from "@/lib/usage/aggregate";
import type { ClaudeQuota, CodexLiveQuota } from "@/lib/types/usage";

interface SeedSession {
  id: string;
  projectId?: string;
  status?: string;
  provider?: string | null;
  namedAgentId?: string | null;
  namedAgentName?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalCostUsd?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt?: string | null;
}

function seedSession(session: SeedSession): void {
  testDb
    .instance!.sqlite.prepare(
      `INSERT INTO agent_sessions (
         id, project_id, status, provider, named_agent_id, named_agent_name,
         input_tokens, output_tokens, total_cost_usd,
         started_at, ended_at, created_at
       ) VALUES (
         @id, @projectId, @status, @provider, @namedAgentId, @namedAgentName,
         @inputTokens, @outputTokens, @totalCostUsd,
         @startedAt, @endedAt, @createdAt
       )`,
    )
    .run({
      id: session.id,
      projectId: session.projectId ?? "p1",
      status: session.status ?? "completed",
      provider: session.provider === undefined ? "claude-code" : session.provider,
      namedAgentId: session.namedAgentId ?? null,
      namedAgentName: session.namedAgentName ?? null,
      inputTokens: session.inputTokens ?? null,
      outputTokens: session.outputTokens ?? null,
      totalCostUsd: session.totalCostUsd ?? null,
      startedAt: session.startedAt ?? null,
      endedAt: session.endedAt ?? null,
      createdAt: session.createdAt ?? "2026-08-01T00:00:00.000Z",
    });
}

function seedSnapshot(row: Record<string, unknown>): void {
  testDb
    .instance!.sqlite.prepare(
      `INSERT INTO provider_usage_snapshots (
         provider, captured_at, plan_type,
         primary_used_percent, primary_window_minutes, primary_resets_at,
         secondary_used_percent, secondary_window_minutes, secondary_resets_at,
         source_file, raw_json
       ) VALUES (
         @provider, @capturedAt, @planType,
         @primaryUsedPercent, @primaryWindowMinutes, @primaryResetsAt,
         @secondaryUsedPercent, @secondaryWindowMinutes, @secondaryResetsAt,
         @sourceFile, @rawJson
       )`,
    )
    .run({
      provider: "codex",
      capturedAt: "2026-06-18T18:00:00.000Z",
      planType: "prolite",
      primaryUsedPercent: 6,
      primaryWindowMinutes: 300,
      primaryResetsAt: 1781795185,
      secondaryUsedPercent: 1,
      secondaryWindowMinutes: 10080,
      secondaryResetsAt: 1782381985,
      sourceFile: "/home/u/.codex/sessions/2026/06/18/rollout-x.jsonl",
      rawJson: '{"limit_id":"codex"}',
      ...row,
    });
}

function setBudget(value: string): void {
  testDb
    .instance!.sqlite.prepare(
      "INSERT INTO settings (key, value) VALUES ('usage_budget_usd_7d_claude', ?)",
    )
    .run(value);
}

beforeEach(() => {
  testDb.instance = createTestDb();
  testDb.instance.sqlite
    .prepare("INSERT INTO projects (id, name) VALUES ('p1', 'Project One')")
    .run();
  testDb.instance.sqlite
    .prepare("INSERT INTO projects (id, name) VALUES ('p2', 'Project Two')")
    .run();
  // agent_sessions.named_agent_id carries a real FK to named_agents.
  testDb.instance.sqlite
    .prepare(
      "INSERT INTO named_agents (id, name, provider, model) VALUES ('a1', 'Builder', 'claude-code', 'claude-opus-4-6')",
    )
    .run();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getUsageReport — empty database", () => {
  it("reports zero sessions with null money, never fake zeros", () => {
    const report = getUsageReport();

    expect(report.totals).toEqual({
      sessions: 0,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
    expect(report.byAgent).toEqual([]);
    expect(report.byProvider).toEqual([]);
    expect(report.byProject).toEqual([]);
    expect(report.windows.last5h.costUsd).toBeNull();
    expect(report.windows.last7d.sessions).toBe(0);
  });

  it("still emits exactly 30 zero-filled day buckets", () => {
    const report = getUsageReport();
    expect(report.byDay).toHaveLength(30);
    expect(report.byDay.every((d) => d.sessions === 0)).toBe(true);
    expect(report.byDay.every((d) => d.costUsd === null)).toBe(true);
  });

  it("always includes the claude subscription card and nothing else", () => {
    const report = getUsageReport();
    expect(report.subscriptions).toHaveLength(1);
    expect(report.subscriptions[0].provider).toBe("claude-code");
    expect(report.subscriptions[0].source).toBe("metered-via-arij");
  });
});

describe("getUsageReport — totals and groupings", () => {
  beforeEach(() => {
    seedSession({
      id: "s1",
      projectId: "p1",
      namedAgentId: "a1",
      namedAgentName: "Builder",
      inputTokens: 100,
      outputTokens: 10,
      totalCostUsd: 1.5,
      endedAt: "2026-08-10T10:00:00.000Z",
    });
    seedSession({
      id: "s2",
      projectId: "p1",
      namedAgentId: "a1",
      namedAgentName: "Builder",
      inputTokens: 200,
      outputTokens: 20,
      totalCostUsd: 2.5,
      endedAt: "2026-08-11T10:00:00.000Z",
    });
    // Legacy row: provider column is NULL and must normalize to claude-code.
    seedSession({
      id: "s3",
      projectId: "p2",
      provider: null,
      namedAgentName: "Reviewer",
      totalCostUsd: 0.5,
      endedAt: "2026-08-12T10:00:00.000Z",
    });
    // Codex reports no tokens/cost to Arij today — the whole group stays null.
    seedSession({
      id: "s4",
      projectId: "p2",
      provider: "codex",
      namedAgentName: "Scout",
      endedAt: "2026-08-13T10:00:00.000Z",
    });
    // Queued: counts as a session, contributes no usage, has no ended_at.
    seedSession({ id: "s5", projectId: "p1", status: "queued" });
  });

  it("counts every session but sums only reported usage", () => {
    const report = getUsageReport();
    expect(report.totals).toEqual({
      sessions: 5,
      inputTokens: 300,
      outputTokens: 30,
      costUsd: 4.5,
    });
  });

  it("normalizes a NULL provider to claude-code", () => {
    const providers = getUsageReport().byProvider;
    const claude = providers.find((p) => p.provider === "claude-code");
    expect(claude).toMatchObject({ sessions: 4, costUsd: 4.5 });
  });

  it("returns null (not 0) for a provider group that never reported cost", () => {
    const codex = getUsageReport().byProvider.find((p) => p.provider === "codex");
    expect(codex).toEqual({
      provider: "codex",
      sessions: 1,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
  });

  it("orders providers by cost desc with null-cost groups last", () => {
    expect(getUsageReport().byProvider.map((p) => p.provider)).toEqual([
      "claude-code",
      "codex",
    ]);
  });

  it("groups agents by (name x provider) and orders by cost desc, nulls last", () => {
    const rows = getUsageReport().byAgent;
    expect(rows[0]).toMatchObject({
      name: "Builder",
      provider: "claude-code",
      namedAgentId: "a1",
      sessions: 2,
      inputTokens: 300,
      outputTokens: 30,
      costUsd: 4,
    });
    expect(rows[1]).toMatchObject({ name: "Reviewer", costUsd: 0.5 });
    // The null-cost tail: order between equal-session groups is unspecified.
    expect(new Set(rows.slice(2).map((r) => r.name))).toEqual(
      new Set([null, "Scout"]),
    );
    expect(rows.slice(2).every((r) => r.costUsd === null)).toBe(true);
  });

  it("keeps the agent name null for sessions with no named agent", () => {
    const unnamed = getUsageReport().byAgent.find((r) => r.name === null);
    expect(unnamed).toBeDefined();
    expect(unnamed!.namedAgentId).toBeNull();
    expect(unnamed!.sessions).toBe(1);
  });

  it("derives lastActiveAt from ended_at, falling back to created_at", () => {
    const rows = getUsageReport().byAgent;
    expect(rows.find((r) => r.name === "Builder")!.lastActiveAt).toBe(
      "2026-08-11T10:00:00.000Z",
    );
    // The queued session has neither started_at nor ended_at.
    expect(rows.find((r) => r.name === null)!.lastActiveAt).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("splits by project and resolves the project name", () => {
    const rows = getUsageReport().byProject;
    expect(rows[0]).toMatchObject({
      projectId: "p1",
      projectName: "Project One",
      sessions: 3,
      costUsd: 4,
    });
    expect(rows[1]).toMatchObject({
      projectId: "p2",
      projectName: "Project Two",
      sessions: 2,
      costUsd: 0.5,
    });
  });
});

describe("getUsageReport — rolling window math", () => {
  const NOW = new Date("2026-08-18T12:00:00.000Z");

  function agoIso(ms: number): string {
    return new Date(NOW.getTime() - ms).toISOString();
  }

  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const DAY = 24 * HOUR;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // Straddling the 5h edge.
    seedSession({
      id: "in5h",
      endedAt: agoIso(4 * HOUR + 59 * MINUTE),
      inputTokens: 10,
      outputTokens: 1,
      totalCostUsd: 1,
    });
    seedSession({
      id: "out5h",
      endedAt: agoIso(5 * HOUR + 1 * MINUTE),
      inputTokens: 20,
      outputTokens: 2,
      totalCostUsd: 2,
    });
    // Straddling the 7d edge.
    seedSession({
      id: "in7d",
      endedAt: agoIso(6 * DAY + 23 * HOUR),
      inputTokens: 40,
      outputTokens: 4,
      totalCostUsd: 4,
    });
    seedSession({
      id: "out7d",
      endedAt: agoIso(7 * DAY + 1 * HOUR),
      inputTokens: 80,
      outputTokens: 8,
      totalCostUsd: 8,
    });
  });

  it("includes 4h59-old and excludes 5h01-old sessions in the 5h window", () => {
    const w = getUsageReport().windows.last5h;
    expect(w).toEqual({
      sessions: 1,
      inputTokens: 10,
      outputTokens: 1,
      costUsd: 1,
    });
  });

  it("includes 6d23h-old and excludes 7d01h-old sessions in the 7d window", () => {
    const w = getUsageReport().windows.last7d;
    expect(w.sessions).toBe(3);
    expect(w.costUsd).toBe(7); // 1 + 2 + 4, never the 8 that fell out
    expect(w.inputTokens).toBe(70);
  });

  it("ignores sessions that never ended, whatever their status", () => {
    seedSession({ id: "running", status: "running", startedAt: agoIso(HOUR) });
    const w = getUsageReport().windows.last5h;
    expect(w.sessions).toBe(1);
  });

  it("scopes the claude metered card to claude-code sessions only", () => {
    seedSession({
      id: "codex-recent",
      provider: "codex",
      endedAt: agoIso(HOUR),
    });
    const report = getUsageReport();

    expect(report.windows.last5h.sessions).toBe(2); // global window sees both
    const claude = report.subscriptions.find((s) => s.provider === "claude-code")!;
    expect(claude.metered!.last5h.sessions).toBe(1);
    expect(claude.metered!.last7d.sessions).toBe(3);
  });

  it("counts a legacy NULL-provider session as claude-code when metering", () => {
    seedSession({
      id: "legacy-recent",
      provider: null,
      endedAt: agoIso(HOUR),
      totalCostUsd: 3,
    });
    const claude = getUsageReport().subscriptions.find(
      (s) => s.provider === "claude-code",
    )!;
    expect(claude.metered!.last5h.sessions).toBe(2);
    expect(claude.metered!.last5h.costUsd).toBe(4);
  });
});

describe("getUsageReport — 30-day strip", () => {
  function localDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  it("returns 30 buckets oldest-first ending today, in LOCAL dates", () => {
    const report = getUsageReport();
    expect(report.byDay).toHaveLength(30);
    expect(report.byDay[29].date).toBe(localDateKey(new Date()));

    const oldest = new Date();
    oldest.setDate(oldest.getDate() - 29);
    expect(report.byDay[0].date).toBe(localDateKey(oldest));
    expect(report.byDay[0].date < report.byDay[29].date).toBe(true);
  });

  it("buckets a session that just ended into today", () => {
    seedSession({
      id: "today",
      endedAt: new Date().toISOString(),
      totalCostUsd: 2.25,
    });
    const today = getUsageReport().byDay[29];
    expect(today.sessions).toBe(1);
    expect(today.costUsd).toBe(2.25);
  });

  it("drops sessions older than the 30-day range", () => {
    const old = new Date();
    old.setDate(old.getDate() - 40);
    seedSession({ id: "ancient", endedAt: old.toISOString(), totalCostUsd: 99 });

    const report = getUsageReport();
    expect(report.byDay.every((d) => d.sessions === 0)).toBe(true);
    expect(report.byDay.some((d) => d.costUsd === 99)).toBe(false);
  });

  it("keeps costUsd null on a day whose sessions reported no cost", () => {
    seedSession({
      id: "codex-today",
      provider: "codex",
      endedAt: new Date().toISOString(),
    });
    const today = getUsageReport().byDay[29];
    expect(today.sessions).toBe(1);
    expect(today.costUsd).toBeNull();
  });
});

describe("getUsageReport — subscriptions", () => {
  it("omits codex entirely when there is no snapshot and no codex session", () => {
    seedSession({ id: "s1", endedAt: "2026-08-10T10:00:00.000Z" });
    const report = getUsageReport();
    expect(report.subscriptions.map((s) => s.provider)).toEqual(["claude-code"]);
  });

  it("shows codex with all-null fields when sessions exist but no snapshot does", () => {
    seedSession({
      id: "s1",
      provider: "codex",
      endedAt: "2026-08-10T10:00:00.000Z",
    });
    const codex = getUsageReport().subscriptions.find(
      (s) => s.provider === "codex",
    )!;
    expect(codex).toEqual({
      provider: "codex",
      source: "provider-reported",
      sourceDetail: "rollout-snapshot",
      plan: null,
      capturedAt: null,
      primary: null,
      secondary: null,
      metered: null,
      claudeLive: null,
      codexLive: null,
    });
  });

  it("returns the provider-reported snapshot verbatim, staleness included", () => {
    seedSnapshot({});
    const codex = getUsageReport().subscriptions.find(
      (s) => s.provider === "codex",
    )!;

    expect(codex.source).toBe("provider-reported");
    expect(codex.sourceDetail).toBe("rollout-snapshot");
    expect(codex.claudeLive).toBeNull();
    expect(codex.codexLive).toBeNull();
    expect(codex.plan).toBe("prolite");
    // Months-old capture is returned as-is: the UI marks it stale, the API
    // never extrapolates a fresher number.
    expect(codex.capturedAt).toBe("2026-06-18T18:00:00.000Z");
    expect(codex.primary).toEqual({
      usedPercent: 6,
      windowMinutes: 300,
      resetsAt: 1781795185, // unix SECONDS, untouched
    });
    expect(codex.secondary).toEqual({
      usedPercent: 1,
      windowMinutes: 10080,
      resetsAt: 1782381985,
    });
    expect(codex.metered).toBeNull();
  });

  it("drops a snapshot window whose used_percent was never recorded", () => {
    seedSnapshot({
      secondaryUsedPercent: null,
      secondaryWindowMinutes: null,
      secondaryResetsAt: null,
    });
    const codex = getUsageReport().subscriptions.find(
      (s) => s.provider === "codex",
    )!;
    expect(codex.primary).not.toBeNull();
    expect(codex.secondary).toBeNull();
  });

  it("never labels claude as provider-reported and never gives it a snapshot", () => {
    seedSnapshot({});
    const claude = getUsageReport().subscriptions.find(
      (s) => s.provider === "claude-code",
    )!;
    expect(claude.source).toBe("metered-via-arij");
    expect(claude.sourceDetail).toBe("arij-sessions");
    expect(claude.capturedAt).toBeNull();
    expect(claude.primary).toBeNull();
    expect(claude.secondary).toBeNull();
    expect(claude.plan).toBeNull();
    expect(claude.metered).not.toBeNull();
    expect(claude.claudeLive).toBeNull();
    expect(claude.codexLive).toBeNull();
  });

  it("computes an unclamped budget percentage when a budget is set", () => {
    seedSession({
      id: "s1",
      endedAt: new Date(Date.now() - 60_000).toISOString(),
      totalCostUsd: 75,
    });
    setBudget("50");

    const claude = getUsageReport().subscriptions.find(
      (s) => s.provider === "claude-code",
    )!;
    expect(claude.metered!.budgetUsdWeek).toBe(50);
    expect(claude.metered!.budgetUsedPercent).toBe(150);
  });

  it("has no budget percent when no budget is configured", () => {
    seedSession({
      id: "s1",
      endedAt: new Date(Date.now() - 60_000).toISOString(),
      totalCostUsd: 75,
    });
    const claude = getUsageReport().subscriptions.find(
      (s) => s.provider === "claude-code",
    )!;
    expect(claude.metered!.budgetUsdWeek).toBeNull();
    expect(claude.metered!.budgetUsedPercent).toBeNull();
  });

  it.each([
    ["zero", "0"],
    ["negative", "-10"],
    ["null", "null"],
    ["a string", '"50"'],
    ["corrupt JSON", "{oops"],
  ])("treats a %s budget as no budget", (_label, raw) => {
    setBudget(raw);
    const claude = getUsageReport().subscriptions.find(
      (s) => s.provider === "claude-code",
    )!;
    expect(claude.metered!.budgetUsdWeek).toBeNull();
    expect(claude.metered!.budgetUsedPercent).toBeNull();
  });

  it("has no budget percent when the budget exists but nothing was spent", () => {
    setBudget("50");
    const claude = getUsageReport().subscriptions.find(
      (s) => s.provider === "claude-code",
    )!;
    expect(claude.metered!.budgetUsdWeek).toBe(50);
    expect(claude.metered!.last7d.costUsd).toBeNull();
    expect(claude.metered!.budgetUsedPercent).toBeNull();
  });
});

describe("getUsageReport — live-quota assembly (feat/live-quota)", () => {
  const CLAUDE_LIVE: ClaudeQuota = {
    subscriptionType: "max",
    fiveHour: { utilizationPercent: 34, resetsAtIso: "2026-08-18T16:00:00+00:00" },
    sevenDay: { utilizationPercent: 61, resetsAtIso: "2026-08-21T09:00:00+00:00" },
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [
      {
        displayName: "Opus 4.5",
        utilizationPercent: 12,
        resetsAtIso: "2026-08-21T09:00:00+00:00",
      },
    ],
    extraUsage: {
      isEnabled: true,
      monthlyLimit: 100,
      usedCredits: 12.5,
      utilizationPercent: 12.5,
    },
  };

  const CODEX_LIVE: CodexLiveQuota = {
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
      {
        limitId: "codex_bengalfox",
        limitName: "GPT-5.3-Codex-Spark",
        usedPercent: 2,
        windowDurationMins: 10080,
        resetsAtUnix: 1787671089,
        secondary: null,
      },
    ],
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    dailyUsage: [
      { date: "2026-08-15", tokens: 26808416 },
      { date: "2026-08-18", tokens: 20928692 },
    ],
    lifetimeTokens: 1383498631,
  };

  const NO_LIVE = { data: null, capturedAtIso: null };

  function live(overrides: Partial<LiveQuotaInputs>): LiveQuotaInputs {
    return { claudeLive: NO_LIVE, codexLive: NO_LIVE, ...overrides };
  }

  it("promotes claude to provider-reported live-cli with metered STILL populated", () => {
    seedSession({
      id: "s1",
      endedAt: new Date(Date.now() - 60_000).toISOString(),
      totalCostUsd: 2,
    });
    const withLive = getUsageReport(
      live({
        claudeLive: { data: CLAUDE_LIVE, capturedAtIso: "2026-08-18T11:58:00.000Z" },
      }),
    ).subscriptions.find((s) => s.provider === "claude-code")!;
    const fallback = getUsageReport().subscriptions.find(
      (s) => s.provider === "claude-code",
    )!;

    expect(withLive.source).toBe("provider-reported");
    expect(withLive.sourceDetail).toBe("live-cli");
    expect(withLive.plan).toBe("max");
    expect(withLive.capturedAt).toBe("2026-08-18T11:58:00.000Z");
    expect(withLive.claudeLive).toEqual(CLAUDE_LIVE);
    expect(withLive.codexLive).toBeNull();
    // ISO resets stay in claudeLive; the unix-seconds path is never a hybrid.
    expect(withLive.primary).toBeNull();
    expect(withLive.secondary).toBeNull();
    // Both truths ship: metered carries today's exact numbers.
    expect(withLive.metered).toEqual(fallback.metered);
    expect(withLive.metered!.last5h.costUsd).toBe(2);
  });

  it("gives codex a live-cli card even with no snapshot and no codex sessions", () => {
    const report = getUsageReport(
      live({
        codexLive: { data: CODEX_LIVE, capturedAtIso: "2026-08-18T11:58:00.000Z" },
      }),
    );
    const codex = report.subscriptions.find((s) => s.provider === "codex")!;

    expect(codex.source).toBe("provider-reported");
    expect(codex.sourceDetail).toBe("live-cli");
    expect(codex.plan).toBe("prolite");
    expect(codex.capturedAt).toBe("2026-08-18T11:58:00.000Z");
    expect(codex.codexLive).toEqual(CODEX_LIVE);
    expect(codex.claudeLive).toBeNull();
    expect(codex.metered).toBeNull();
    // primary/secondary mirror the "codex" bucket for SnapshotWindow parity.
    expect(codex.primary).toEqual({
      usedPercent: 6,
      windowMinutes: 10080,
      resetsAt: 1787671089,
    });
    expect(codex.secondary).toBeNull();
  });

  it("live codex beats a present rollout snapshot (precedence)", () => {
    seedSnapshot({});
    const codex = getUsageReport(
      live({
        codexLive: { data: CODEX_LIVE, capturedAtIso: "2026-08-18T11:58:00.000Z" },
      }),
    ).subscriptions.find((s) => s.provider === "codex")!;

    expect(codex.sourceDetail).toBe("live-cli");
    expect(codex.capturedAt).toBe("2026-08-18T11:58:00.000Z"); // not the snapshot's
    expect(codex.primary!.windowMinutes).toBe(10080); // live bucket, not 300
  });

  it("mirrors a dual-window bucket's secondary into the window status", () => {
    const dualWindow: CodexLiveQuota = {
      ...CODEX_LIVE,
      buckets: [
        {
          limitId: "codex",
          limitName: null,
          usedPercent: 1,
          windowDurationMins: 300,
          resetsAtUnix: 1778890682,
          secondary: {
            usedPercent: 0,
            windowDurationMins: 10080,
            resetsAtUnix: 1779477482,
          },
        },
      ],
    };
    const codex = getUsageReport(
      live({ codexLive: { data: dualWindow, capturedAtIso: "2026-08-18T11:58:00.000Z" } }),
    ).subscriptions.find((s) => s.provider === "codex")!;

    expect(codex.primary).toEqual({
      usedPercent: 1,
      windowMinutes: 300,
      resetsAt: 1778890682,
    });
    expect(codex.secondary).toEqual({
      usedPercent: 0,
      windowMinutes: 10080,
      resetsAt: 1779477482,
    });
  });

  it("falls back to buckets[0] when no bucket is named 'codex'", () => {
    const renamed: CodexLiveQuota = {
      ...CODEX_LIVE,
      buckets: [{ ...CODEX_LIVE.buckets[1] }],
    };
    const codex = getUsageReport(
      live({ codexLive: { data: renamed, capturedAtIso: "2026-08-18T11:58:00.000Z" } }),
    ).subscriptions.find((s) => s.provider === "codex")!;

    expect(codex.primary).toEqual({
      usedPercent: 2,
      windowMinutes: 10080,
      resetsAt: 1787671089,
    });
  });

  it("keeps byDay Arij-metered — codex dailyUsage never merges into it", () => {
    const report = getUsageReport(
      live({
        codexLive: { data: CODEX_LIVE, capturedAtIso: "2026-08-18T11:58:00.000Z" },
      }),
    );

    expect(report.byDay).toHaveLength(30);
    expect(report.byDay.every((d) => d.sessions === 0)).toBe(true);
    expect(report.byDay.every((d) => d.costUsd === null)).toBe(true);
    // The provider history lives ONLY on the subscription card payload.
    const codex = report.subscriptions.find((s) => s.provider === "codex")!;
    expect(codex.codexLive!.dailyUsage).toHaveLength(2);
  });

  it("defaults to the no-live state — a zero-arg call is byte-identical fallback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
    seedSession({ id: "s1", endedAt: "2026-08-18T11:30:00.000Z", totalCostUsd: 1 });
    seedSnapshot({});

    expect(getUsageReport()).toEqual(
      getUsageReport({ claudeLive: NO_LIVE, codexLive: NO_LIVE }),
    );
  });
});

describe("storeCodexLiveSnapshot — live poll -> snapshot row (feat/live-quota)", () => {
  const LIVE_QUOTA: CodexLiveQuota = {
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
    credits: null,
    dailyUsage: [],
    lifetimeTokens: null,
  };

  function readSnapshotRow(): Record<string, unknown> | undefined {
    return testDb
      .instance!.sqlite.prepare(
        "SELECT * FROM provider_usage_snapshots WHERE provider = 'codex'",
      )
      .get() as Record<string, unknown> | undefined;
  }

  it("upserts the codex bucket with wall-clock capturedAt and live provenance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
    const { storeCodexLiveSnapshot } = await import("@/lib/usage/codex-snapshot");

    storeCodexLiveSnapshot(LIVE_QUOTA, '{"rateLimits":{"limitId":"codex"}}');

    const row = readSnapshotRow()!;
    expect(row.captured_at).toBe("2026-08-18T12:00:00.000Z");
    expect(row.plan_type).toBe("prolite");
    expect(row.primary_used_percent).toBe(6);
    expect(row.primary_window_minutes).toBe(10080);
    expect(row.primary_resets_at).toBe(1787671089);
    expect(row.secondary_used_percent).toBeNull();
    expect(row.source_file).toBe("live:codex-app-server");
    expect(row.raw_json).toBe('{"rateLimits":{"limitId":"codex"}}');
  });

  it("overwrites an older rollout snapshot (live 'now' >= any past event)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
    seedSnapshot({ capturedAt: "2026-08-18T09:00:00.000Z" });
    const { storeCodexLiveSnapshot } = await import("@/lib/usage/codex-snapshot");

    storeCodexLiveSnapshot(LIVE_QUOTA, "{}");

    const row = readSnapshotRow()!;
    expect(row.captured_at).toBe("2026-08-18T12:00:00.000Z");
    expect(row.source_file).toBe("live:codex-app-server");
  });

  it("respects the forward-only guard against a newer existing capture", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
    seedSnapshot({ capturedAt: "2026-08-18T13:00:00.000Z" }); // clock skew case
    const { storeCodexLiveSnapshot } = await import("@/lib/usage/codex-snapshot");

    storeCodexLiveSnapshot(LIVE_QUOTA, "{}");

    const row = readSnapshotRow()!;
    expect(row.captured_at).toBe("2026-08-18T13:00:00.000Z"); // untouched
    expect(row.source_file).not.toBe("live:codex-app-server");
  });

  it("mirrors a dual-window bucket into the secondary columns", async () => {
    const dual: CodexLiveQuota = {
      ...LIVE_QUOTA,
      buckets: [
        {
          ...LIVE_QUOTA.buckets[0],
          secondary: {
            usedPercent: 1,
            windowDurationMins: 10080,
            resetsAtUnix: 1779477482,
          },
        },
      ],
    };
    const { storeCodexLiveSnapshot } = await import("@/lib/usage/codex-snapshot");

    storeCodexLiveSnapshot(dual, "{}");

    const row = readSnapshotRow()!;
    expect(row.secondary_used_percent).toBe(1);
    expect(row.secondary_window_minutes).toBe(10080);
    expect(row.secondary_resets_at).toBe(1779477482);
  });

  it("never throws, even when the table is unavailable", async () => {
    const { storeCodexLiveSnapshot } = await import("@/lib/usage/codex-snapshot");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    testDb.instance!.sqlite.exec("DROP TABLE provider_usage_snapshots");

    expect(() => storeCodexLiveSnapshot(LIVE_QUOTA, "{}")).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("getUsageReport — envelope", () => {
  it("stamps generatedAt as an ISO UTC instant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
    expect(getUsageReport().generatedAt).toBe("2026-08-18T12:00:00.000Z");
  });
});
