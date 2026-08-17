import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}));

const nightState = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  activeRun: null as Record<string, unknown> | null,
  loading: false,
  detail: null as Record<string, unknown> | null,
}));

vi.mock("@/hooks/useNightRuns", () => ({
  useNightRuns: () => ({
    runs: nightState.runs,
    activeRun: nightState.activeRun,
    loading: nightState.loading,
    refresh: vi.fn(),
  }),
  useNightRunDetail: () => ({
    detail: nightState.detail,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

const inboxState = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  loading: false,
}));

vi.mock("@/hooks/useInbox", () => ({
  useInbox: () => ({
    items: inboxState.items,
    unreadCount: 0,
    loading: inboxState.loading,
    markRead: vi.fn(),
    reply: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { CockpitBar } from "@/components/layout/CockpitBar";

const fetchState = {
  active: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<Record<string, unknown>>,
};

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe("CockpitBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nightState.runs = [];
    nightState.activeRun = null;
    nightState.loading = false;
    nightState.detail = null;
    inboxState.items = [];
    inboxState.loading = false;
    fetchState.active = [];
    fetchState.sessions = [];

    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/sessions/active")) {
        return { json: async () => ({ data: fetchState.active }) } as Response;
      }
      if (String(url).includes("/sessions")) {
        return { json: async () => ({ data: fetchState.sessions }) } as Response;
      }
      return { json: async () => ({ data: [] }) } as Response;
    }) as unknown as typeof fetch;
  });

  it("always renders the four cells, with honest empty states", async () => {
    render(<CockpitBar projectId="p1" />);

    expect(screen.getByTestId("cockpit-bar")).toBeInTheDocument();
    expect(screen.getByTestId("cockpit-night-run")).toHaveTextContent(
      "No night runs yet"
    );
    expect(screen.getByTestId("cockpit-agents")).toHaveTextContent(
      "None right now"
    );
    expect(screen.getByTestId("cockpit-awaiting")).toHaveTextContent("All clear");
    await waitFor(() => {
      expect(screen.getByTestId("cockpit-yesterday")).toHaveTextContent(
        "0 done · 0 failed"
      );
    });
  });

  it("shows the live night run with a breathing dot, wave, epics and cost", async () => {
    nightState.activeRun = {
      runId: "night_a41c",
      state: "running",
      interrupted: false,
      counts: {},
      totalCostUsd: 0,
    };
    nightState.runs = [nightState.activeRun];
    nightState.detail = {
      runId: "night_a41c",
      currentWave: 2,
      totalWaves: 3,
      epics: [{}, {}, {}, {}, {}],
      totalCostUsd: 1.1,
      costIsPartial: false,
      interrupted: false,
      counts: {},
    };

    const { container } = render(<CockpitBar projectId="p1" />);

    expect(screen.getByTestId("cockpit-night-run")).toHaveTextContent(
      "Wave 2/3 · 5 epics · $1.10"
    );
    expect(container.querySelector(".breathing-dot")).not.toBeNull();
    // Let the ambient pollers settle so the async state updates stay inside act().
    await waitFor(() => {
      expect(screen.getByTestId("cockpit-yesterday")).toHaveTextContent(
        "0 done · 0 failed"
      );
    });
  });

  it("falls back to the last finished run and deep-links to its summary", async () => {
    const user = userEvent.setup();
    nightState.runs = [
      {
        runId: "night_a41c",
        state: "finished",
        interrupted: false,
        counts: { done: 4, failed: 1 },
        totalCostUsd: 4.2,
      },
    ];

    render(<CockpitBar projectId="p1" />);

    const button = screen.getByTestId("night-last-run-button");
    expect(button).toHaveTextContent("Last night: 4 done · 1 failed");

    await user.click(button);
    expect(nav.push).toHaveBeenCalledWith("/projects/p1?nightRun=night_a41c");
  });

  it("lists at most two running agents and counts the rest", async () => {
    fetchState.active = [
      { id: "s1", label: "Claude Code · build E-093", status: "running" },
      { id: "s2", label: "Codex · review E-001", status: "running" },
      { id: "s3", label: "Claude Code · merge E-004", status: "running" },
      { id: "s4", label: "Queued one", status: "queued" },
    ];

    render(<CockpitBar projectId="p1" />);

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-agents")).toHaveTextContent(
        "Claude Code · build E-093 · Codex · review E-001 · +1 more"
      );
    });
  });

  it("counts this project's awaiting-reply tickets and opens the first one", async () => {
    const user = userEvent.setup();
    inboxState.items = [
      {
        epicId: "e1",
        projectId: "p1",
        readableId: "E-arij-008",
        awaitingReply: true,
      },
      {
        epicId: "e2",
        projectId: "p1",
        readableId: "E-arij-011",
        awaitingReply: true,
      },
      // Another project's question must not leak into this cockpit.
      {
        epicId: "e9",
        projectId: "p2",
        readableId: "E-other-001",
        awaitingReply: true,
      },
      // Unread but not awaiting a reply — not a question.
      {
        epicId: "e3",
        projectId: "p1",
        readableId: "E-arij-012",
        awaitingReply: false,
      },
    ];

    render(<CockpitBar projectId="p1" />);

    const cell = screen.getByTestId("cockpit-awaiting");
    expect(cell).toHaveTextContent("2 questions · E-arij-008");

    await user.click(screen.getByTestId("cockpit-awaiting-link"));
    expect(nav.push).toHaveBeenCalledWith("/projects/p1?ticket=e1");
  });

  it("counts only terminal agent sessions from the last 24h in Yesterday", async () => {
    fetchState.sessions = [
      { kind: "agent_session", status: "completed", endedAt: isoAgo(3600_000) },
      { kind: "agent_session", status: "completed", endedAt: isoAgo(7200_000) },
      { kind: "agent_session", status: "failed", endedAt: isoAgo(1800_000) },
      // Older than the window.
      { kind: "agent_session", status: "completed", endedAt: isoAgo(90_000_000) },
      // Still running — not an outcome.
      { kind: "agent_session", status: "running", endedAt: null },
      // Chat conversations are not agent sessions.
      { kind: "chat_session", status: "completed", endedAt: isoAgo(600_000) },
    ];

    render(<CockpitBar projectId="p1" />);

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-yesterday")).toHaveTextContent(
        "2 done · 1 failed"
      );
    });
  });

  it("reads sqlite CURRENT_TIMESTAMP fallbacks as UTC, not local time", async () => {
    // `created_at` has no zone marker; a naive Date.parse would shift it by the
    // machine offset and drop (or invent) sessions at the window edge.
    const sqliteNow = new Date(Date.now() - 3600_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    fetchState.sessions = [
      { kind: "agent_session", status: "completed", createdAt: sqliteNow },
    ];

    render(<CockpitBar projectId="p1" />);

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-yesterday")).toHaveTextContent(
        "1 done · 0 failed"
      );
    });
  });
});
