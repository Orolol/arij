/**
 * Usage observatory page: the two gauge sources (provider-reported vs
 * metered-via-Arij), honest empty states, the per-agent table order, and the
 * CSS-only 30-day strip.
 *
 * Fixtures are hand-written to the §3 UsageReport contract shape — the page
 * imports that type only via `import type`, so these tests pin the wire
 * shape independently of the backend builder.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import UsagePage from "@/app/usage/page";
import type {
  AgentUsageRow,
  DayUsageRow,
  SubscriptionStatus,
  UsageReport,
} from "@/lib/types/usage";

/** Frozen "now": 2026-08-18 12:00 UTC. */
const FIXED_NOW = Date.parse("2026-08-18T12:00:00.000Z");
const NOW_SEC = Math.floor(FIXED_NOW / 1000);

/** Exactly 30 local calendar days, oldest first: Jul 20 → Aug 18. */
const DAY_KEYS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => `2026-07-${20 + i}`),
  ...Array.from(
    { length: 18 },
    (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`
  ),
];

function makeDays(
  overrides: Record<string, { sessions: number; costUsd: number | null }> = {}
): DayUsageRow[] {
  return DAY_KEYS.map((date) => ({
    date,
    sessions: overrides[date]?.sessions ?? 0,
    costUsd: overrides[date]?.costUsd ?? null,
  }));
}

const CODEX_SUB: SubscriptionStatus = {
  provider: "codex",
  source: "provider-reported",
  plan: "prolite",
  capturedAt: "2026-08-18T10:00:00.000Z", // 2h before FIXED_NOW
  primary: {
    usedPercent: 6,
    windowMinutes: 300,
    resetsAt: NOW_SEC + 4 * 3600 + 12 * 60,
  },
  secondary: {
    usedPercent: 1,
    windowMinutes: 10080,
    resetsAt: NOW_SEC + 3 * 86400 + 2 * 3600,
  },
  metered: null,
};

const CLAUDE_SUB: SubscriptionStatus = {
  provider: "claude-code",
  source: "metered-via-arij",
  plan: null,
  capturedAt: null,
  primary: null,
  secondary: null,
  metered: {
    last5h: {
      sessions: 1,
      inputTokens: 1_000_000,
      outputTokens: 8_000,
      costUsd: 1.2,
    },
    last7d: {
      sessions: 5,
      inputTokens: 40_000_000,
      outputTokens: 300_000,
      costUsd: 30,
    },
    budgetUsdWeek: 50,
    budgetUsedPercent: 60,
  },
};

const AGENT_ROWS: AgentUsageRow[] = [
  {
    namedAgentId: "ag_1",
    name: "Builder",
    provider: "claude-code",
    sessions: 4,
    inputTokens: 50_000_000,
    outputTokens: 300_000,
    costUsd: 40.5,
    lastActiveAt: "2026-08-18T09:00:00.000Z",
  },
  {
    namedAgentId: "ag_2",
    name: "Reviewer",
    provider: "claude-code",
    sessions: 2,
    inputTokens: 17_500_000,
    outputTokens: 141_000,
    costUsd: 13.41,
    lastActiveAt: "2026-08-17T09:00:00.000Z",
  },
  {
    namedAgentId: null,
    name: null,
    provider: "codex",
    sessions: 1,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    lastActiveAt: null,
  },
];

function baseReport(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    totals: {
      sessions: 7,
      inputTokens: 67_500_000,
      outputTokens: 441_000,
      costUsd: 53.91,
    },
    byAgent: AGENT_ROWS,
    byProvider: [
      {
        provider: "claude-code",
        sessions: 6,
        inputTokens: 67_500_000,
        outputTokens: 441_000,
        costUsd: 53.91,
      },
      {
        provider: "codex",
        sessions: 1,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    ],
    byProject: [
      {
        projectId: "p1",
        projectName: "Arij",
        sessions: 6,
        inputTokens: 67_500_000,
        outputTokens: 441_000,
        costUsd: 53.91,
      },
      {
        projectId: "p2",
        projectName: null,
        sessions: 1,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    ],
    byDay: makeDays({
      "2026-08-10": { sessions: 5, costUsd: 8 },
      "2026-08-18": { sessions: 3, costUsd: 4 },
    }),
    windows: {
      last5h: {
        sessions: 1,
        inputTokens: 1_000_000,
        outputTokens: 8_000,
        costUsd: 1.2,
      },
      last7d: {
        sessions: 5,
        inputTokens: 40_000_000,
        outputTokens: 300_000,
        costUsd: 30,
      },
    },
    subscriptions: [CODEX_SUB, CLAUDE_SUB],
    generatedAt: "2026-08-18T12:00:00.000Z",
    ...overrides,
  };
}

function mockUsage(report: UsageReport) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: report }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Usage page — synthesis band", () => {
  it("summarizes today, the rolling week, and all-time totals", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-band-today")).toHaveTextContent(
      "3 sessions · $4.00"
    );
    expect(screen.getByTestId("usage-band-7d")).toHaveTextContent(
      "5 sessions · $30.00"
    );
    expect(screen.getByTestId("usage-band-total")).toHaveTextContent("7");
    expect(screen.getByTestId("usage-band-cost")).toHaveTextContent("$53.91");
  });

  it("says so plainly when nothing ran today instead of showing $0", async () => {
    mockUsage(baseReport({ byDay: makeDays() }));
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-band-today")).toHaveTextContent(
      "No sessions today"
    );
  });

  it("drops the cost half rather than faking $0 when cost is unknown", async () => {
    mockUsage(
      baseReport({ byDay: makeDays({ "2026-08-18": { sessions: 2, costUsd: null } }) })
    );
    render(<UsagePage />);

    const today = await screen.findByTestId("usage-band-today");
    expect(today).toHaveTextContent("2 sessions");
    expect(today.textContent).not.toContain("$");
  });
});

describe("Usage page — provider-reported gauges (codex)", () => {
  it("renders both windows from the snapshot and labels the source", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-sub-codex")).toBeInTheDocument();
    expect(screen.getByTestId("usage-sub-codex-source")).toHaveTextContent(
      "Provider-reported"
    );
    expect(screen.getByTestId("usage-sub-codex")).toHaveTextContent(
      "plan: prolite"
    );

    expect(
      screen.getByTestId("usage-sub-codex-primary-readout")
    ).toHaveTextContent("6%");
    expect(screen.getByTestId("usage-sub-codex-primary-fill")).toHaveStyle({
      width: "6%",
    });
    expect(
      screen.getByTestId("usage-sub-codex-secondary-readout")
    ).toHaveTextContent("1%");
  });

  it("counts down to each window reset from the unix-seconds value", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(
      await screen.findByTestId("usage-sub-codex-primary-reset")
    ).toHaveTextContent("resets in 4h 12m");
    expect(screen.getByTestId("usage-sub-codex-secondary-reset")).toHaveTextContent(
      "resets in 3d 2h"
    );
  });

  it("shows the capture time, not the scan time", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    const captured = await screen.findByTestId("usage-sub-codex-captured");
    expect(captured).toHaveTextContent("Captured 2h ago · ~/.codex/sessions");
    expect(captured.className).not.toContain("text-priority-yellow");
  });

  it("flags a snapshot older than a day", async () => {
    mockUsage(
      baseReport({
        subscriptions: [
          { ...CODEX_SUB, capturedAt: "2026-06-18T12:00:00.000Z" },
          CLAUDE_SUB,
        ],
      })
    );
    render(<UsagePage />);

    const captured = await screen.findByTestId("usage-sub-codex-captured");
    expect(captured).toHaveTextContent("Captured 61d ago");
    expect(captured.className).toContain("text-priority-yellow");
  });

  it("marks an elapsed window stale instead of extrapolating it forward", async () => {
    mockUsage(
      baseReport({
        subscriptions: [
          {
            ...CODEX_SUB,
            primary: { usedPercent: 6, windowMinutes: 300, resetsAt: NOW_SEC - 3600 },
          },
          CLAUDE_SUB,
        ],
      })
    );
    render(<UsagePage />);

    expect(
      await screen.findByTestId("usage-sub-codex-primary-reset")
    ).toHaveTextContent("window expired — data stale");
    expect(screen.getByTestId("usage-sub-codex-primary-fill")).toHaveStyle({
      opacity: "0.35",
    });
    // The reported percentage itself is still replayed verbatim.
    expect(
      screen.getByTestId("usage-sub-codex-primary-readout")
    ).toHaveTextContent("6%");
  });

  it("shows an explicit empty state instead of an invented gauge", async () => {
    mockUsage(
      baseReport({
        subscriptions: [
          {
            provider: "codex",
            source: "provider-reported",
            plan: null,
            capturedAt: null,
            primary: null,
            secondary: null,
            metered: null,
          },
          CLAUDE_SUB,
        ],
      })
    );
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-sub-codex-empty")).toHaveTextContent(
      "No provider snapshot found."
    );
    expect(
      screen.queryByTestId("usage-sub-codex-primary")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("usage-sub-codex-captured")
    ).not.toBeInTheDocument();
  });
});

describe("Usage page — metered gauge (claude)", () => {
  it("labels the source as metered and always carries the disclaimer", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(
      await screen.findByTestId("usage-sub-claude-code-source")
    ).toHaveTextContent("Metered via Arij");
    expect(screen.getByTestId("usage-sub-claude-disclaimer")).toHaveTextContent(
      "Sessions recorded by Arij only — not the account's full quota."
    );
  });

  it("breaks the two rolling windows down by sessions, tokens and cost", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-sub-claude-code-5h")).toHaveTextContent(
      "1 session · 1.0M tokens · $1.20"
    );
    expect(screen.getByTestId("usage-sub-claude-code-7d")).toHaveTextContent(
      "5 sessions · 40.3M tokens · $30.00"
    );
  });

  it("renders the budget gauge only when a budget is configured", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(
      await screen.findByTestId("usage-sub-claude-budget-readout")
    ).toHaveTextContent("$30.00 / $50.00");
    expect(screen.getByTestId("usage-sub-claude-budget-fill")).toHaveStyle({
      width: "60%",
    });
  });

  it("hides the budget gauge when no budget is set", async () => {
    mockUsage(
      baseReport({
        subscriptions: [
          CODEX_SUB,
          {
            ...CLAUDE_SUB,
            metered: {
              ...CLAUDE_SUB.metered!,
              budgetUsdWeek: null,
              budgetUsedPercent: null,
            },
          },
        ],
      })
    );
    render(<UsagePage />);

    await screen.findByTestId("usage-sub-claude-code");
    expect(
      screen.queryByTestId("usage-sub-claude-budget")
    ).not.toBeInTheDocument();
  });

  it("clamps the bar but not the readout when the budget is blown", async () => {
    mockUsage(
      baseReport({
        subscriptions: [
          CODEX_SUB,
          {
            ...CLAUDE_SUB,
            metered: {
              ...CLAUDE_SUB.metered!,
              last7d: {
                sessions: 9,
                inputTokens: 80_000_000,
                outputTokens: 600_000,
                costUsd: 70,
              },
              budgetUsdWeek: 50,
              budgetUsedPercent: 140,
            },
          },
        ],
      })
    );
    render(<UsagePage />);

    const readout = await screen.findByTestId("usage-sub-claude-budget-readout");
    expect(readout).toHaveTextContent("$70.00 / $50.00");
    expect(readout.className).toContain("text-destructive");
    expect(screen.getByTestId("usage-sub-claude-budget-fill")).toHaveStyle({
      width: "100%",
    });
  });

  it("shows em-dashes, not zeros, when a window recorded no usage", async () => {
    mockUsage(
      baseReport({
        subscriptions: [
          CODEX_SUB,
          {
            ...CLAUDE_SUB,
            metered: {
              last5h: {
                sessions: 0,
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
              },
              last7d: CLAUDE_SUB.metered!.last7d,
              budgetUsdWeek: null,
              budgetUsedPercent: null,
            },
          },
        ],
      })
    );
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-sub-claude-code-5h")).toHaveTextContent(
      "0 sessions · — tokens · —"
    );
  });
});

describe("Usage page — 30 day strip", () => {
  it("renders exactly 30 bars scaled to the costliest day", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    const strip = await screen.findByTestId("usage-day-strip");
    expect(strip.children).toHaveLength(30);

    // 2026-08-10 is the max ($8), 2026-08-18 is half of it ($4).
    expect(screen.getByTestId("usage-day-2026-08-10")).toHaveStyle({
      height: "100%",
    });
    expect(screen.getByTestId("usage-day-2026-08-18")).toHaveStyle({
      height: "50%",
    });
  });

  it("dims empty days to a baseline sliver instead of hiding them", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    const idle = await screen.findByTestId("usage-day-2026-08-05");
    expect(idle).toHaveStyle({ height: "0%", opacity: "0.25" });
    expect(screen.getByTestId("usage-day-2026-08-10")).toHaveStyle({
      opacity: "0.75",
    });
  });

  it("falls back to session counts when no cost was ever reported", async () => {
    mockUsage(
      baseReport({
        byDay: makeDays({
          "2026-08-10": { sessions: 4, costUsd: null },
          "2026-08-18": { sessions: 1, costUsd: null },
        }),
      })
    );
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-day-2026-08-10")).toHaveStyle({
      height: "100%",
    });
    expect(screen.getByTestId("usage-day-2026-08-18")).toHaveStyle({
      height: "25%",
    });
  });

  it("labels the range with local calendar dates", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    await screen.findByTestId("usage-day-strip");
    expect(screen.getByText("Jul 20")).toBeInTheDocument();
    expect(screen.getByText("Aug 18")).toBeInTheDocument();
  });
});

describe("Usage page — per-agent and per-project tables", () => {
  it("keeps the API's cost-desc order with unpriced agents last", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-agent-row-0")).toHaveTextContent(
      "Builder"
    );
    expect(screen.getByTestId("usage-agent-row-0")).toHaveTextContent("$40.50");
    expect(screen.getByTestId("usage-agent-row-1")).toHaveTextContent("Reviewer");
    expect(screen.getByTestId("usage-agent-row-1")).toHaveTextContent("$13.41");
    expect(screen.getByTestId("usage-agent-row-2")).toHaveTextContent("Unnamed");
  });

  it("renders unreported codex tokens and cost as em-dashes", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    const row = await screen.findByTestId("usage-agent-row-2");
    expect(row).toHaveTextContent("Codex");
    expect(row.textContent).not.toContain("$0");
    expect(row.textContent?.match(/—/g)).toHaveLength(3);
  });

  it("falls back to the project id when the project name is gone", async () => {
    mockUsage(baseReport());
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-project-p1")).toHaveTextContent(
      "Arij"
    );
    const orphan = screen.getByTestId("usage-project-p2");
    expect(orphan).toHaveTextContent("p2");
    expect(orphan).toHaveTextContent("1 session · —");
  });
});

describe("Usage page — states", () => {
  it("shows skeletons before the first response lands", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    render(<UsagePage />);

    expect(screen.getByTestId("usage-loading")).toBeInTheDocument();
  });

  it("offers a retry when the report cannot be loaded", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("shows a fresh-database empty state without faking any bars", async () => {
    mockUsage(
      baseReport({
        totals: {
          sessions: 0,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
        },
        byAgent: [],
        byProvider: [],
        byProject: [],
        byDay: makeDays(),
        windows: {
          last5h: {
            sessions: 0,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
          },
          last7d: {
            sessions: 0,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
          },
        },
        subscriptions: [
          {
            provider: "codex",
            source: "provider-reported",
            plan: null,
            capturedAt: null,
            primary: null,
            secondary: null,
            metered: null,
          },
          {
            ...CLAUDE_SUB,
            metered: {
              last5h: {
                sessions: 0,
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
              },
              last7d: {
                sessions: 0,
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
              },
              budgetUsdWeek: null,
              budgetUsedPercent: null,
            },
          },
        ],
      })
    );
    render(<UsagePage />);

    expect(await screen.findByTestId("usage-empty")).toHaveTextContent(
      "No agent sessions recorded yet."
    );
    expect(screen.queryByTestId("usage-day-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("usage-agent-table")).not.toBeInTheDocument();
    // The band and both subscription cards survive; the cost reads as unknown.
    expect(screen.getByTestId("usage-band-total")).toHaveTextContent("0");
    expect(screen.getByTestId("usage-band-cost")).toHaveTextContent("—");
    expect(screen.getByTestId("usage-sub-codex-empty")).toBeInTheDocument();
    expect(screen.getByTestId("usage-sub-claude-disclaimer")).toBeInTheDocument();
  });

  it("refetches on demand rather than polling", async () => {
    const fetchMock = mockUsage(baseReport());
    render(<UsagePage />);

    await screen.findByTestId("usage-band");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("usage-refresh"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith("/api/usage");
  });
});
