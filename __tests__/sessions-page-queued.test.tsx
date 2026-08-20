/**
 * Sessions list page: the synthesis band derived from the loaded sessions
 * (running / today / success rate / queue), the honest empty states, the
 * client-side filter chips (state, provider, ticket query), and the night-run
 * history the "Night run" chip reveals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SessionsPage from "@/app/projects/[projectId]/sessions/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

// The dialog owns its own rendering matrix in night-run-summary-dialog.test.tsx.
// What this file asserts is the handoff: which run id the page opens it with.
vi.mock("@/components/night/NightRunSummaryDialog", () => ({
  NightRunSummaryDialog: ({
    open,
    runId,
  }: {
    open: boolean;
    runId: string | null;
  }) => (open ? <div data-testid="night-summary-open">{runId}</div> : null),
}));

function agentSession(overrides: Record<string, unknown>) {
  return {
    kind: "agent_session",
    id: "sess-x",
    status: "completed",
    mode: "code",
    provider: "claude-code",
    // "today" so the band's Today/Success-rate cells see it
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function nightRun(overrides: Record<string, unknown>) {
  return {
    runId: "night_a41c",
    projectId: "proj-1",
    source: "db",
    interrupted: false,
    state: "finished",
    startedAt: new Date("2026-08-19T23:04:00Z").toISOString(),
    endedAt: new Date("2026-08-20T02:11:00Z").toISOString(),
    counts: { done: 3, asked: 1, failed: 2, skipped: 0, running: 0, pending: 0 },
    totalCostUsd: 4.2,
    abortReason: null,
    ...overrides,
  };
}

/**
 * The page hits two endpoints: the session list, and — only while the "Night
 * run" chip is active — the night-run list. Route by URL so the two never
 * feed each other the wrong payload.
 */
function mockEndpoints({
  sessions = [] as unknown[],
  nightRuns = [] as unknown[],
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => ({
      ok: true,
      json: async () => ({
        data: String(url).includes("/build/night-runs") ? nightRuns : sessions,
      }),
    }))
  );
}

function mockSessions(data: unknown[]) {
  mockEndpoints({ sessions: data });
}

async function renderPage() {
  render(<SessionsPage />);
  await waitFor(() =>
    expect(screen.queryByText("Loading sessions...")).not.toBeInTheDocument()
  );
}

describe("SessionsPage — synthesis band", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSessions([
      agentSession({ id: "sess-queued", status: "queued" }),
      agentSession({
        id: "sess-running",
        status: "running",
        startedAt: new Date().toISOString(),
      }),
      agentSession({ id: "sess-done", status: "completed", totalCostUsd: 0.5 }),
      agentSession({ id: "sess-failed", status: "failed", error: "boom" }),
    ]);
  });

  it("counts running, today, success rate and the queue", async () => {
    await renderPage();

    expect(screen.getByTestId("sessions-band")).toBeInTheDocument();
    expect(screen.getByTestId("sessions-band-running")).toHaveTextContent(
      "1 session"
    );
    // Terminal sessions created today, with the reported cost summed.
    expect(screen.getByTestId("sessions-band-today")).toHaveTextContent(
      "2 sessions"
    );
    expect(screen.getByTestId("sessions-band-today")).toHaveTextContent("$0.50");
    expect(screen.getByTestId("sessions-band-success")).toHaveTextContent(
      "1 / 2"
    );
    expect(screen.getByTestId("sessions-band-queue")).toHaveTextContent(
      "1 queued"
    );
  });

  it("renders one row per session, with the Queued state spelled out", async () => {
    await renderPage();

    expect(screen.getByTestId("session-row-sess-queued")).toHaveTextContent(
      "Queued"
    );
    expect(screen.getByTestId("session-row-sess-running")).toHaveTextContent(
      "Running"
    );
    expect(screen.getByTestId("session-row-sess-failed")).toHaveTextContent(
      "Failed"
    );
    // The row links to the existing detail route.
    expect(screen.getByTestId("session-row-sess-done")).toHaveAttribute(
      "href",
      "/projects/proj-1/sessions/sess-done"
    );
  });
});

describe("SessionsPage — empty states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("says nothing is queued instead of showing a zero counter", async () => {
    mockSessions([agentSession({ id: "sess-done", status: "completed" })]);
    await renderPage();

    expect(screen.getByTestId("sessions-band-queue")).toHaveTextContent(
      "Nothing queued"
    );
    expect(screen.queryByText(/1 queued/)).not.toBeInTheDocument();
    expect(screen.getByTestId("sessions-band-running")).toHaveTextContent(
      "None right now"
    );
  });

  it("keeps the no-sessions copy when the project never ran anything", async () => {
    mockSessions([]);
    await renderPage();

    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });
});

describe("SessionsPage — filters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSessions([
      agentSession({
        id: "sess-night",
        status: "completed",
        batchRunId: "night_a41c",
        epicId: "epic-9",
      }),
      agentSession({
        id: "sess-day",
        status: "failed",
        batchRunId: "batch_1",
        branchName: "arij/feature-x",
      }),
      agentSession({
        id: "sess-codex",
        status: "running",
        provider: "codex",
        startedAt: new Date().toISOString(),
      }),
    ]);
  });

  it("filters to running sessions only", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("sessions-filter-running"));

    expect(screen.getByTestId("session-row-sess-codex")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-row-sess-night")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-row-sess-day")).not.toBeInTheDocument();
  });

  it("filters to failed sessions only", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("sessions-filter-failed"));

    expect(screen.getByTestId("session-row-sess-day")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-row-sess-codex")
    ).not.toBeInTheDocument();
  });

  it("filters to night-run sessions by their batch tag", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("sessions-filter-night"));
    // The chip also mounts the night-run list; let its fetch settle so the
    // state update lands inside the test.
    await screen.findByTestId("night-runs-list");

    expect(screen.getByTestId("session-row-sess-night")).toBeInTheDocument();
    expect(screen.queryByTestId("session-row-sess-day")).not.toBeInTheDocument();
  });

  it("filters by provider and clears back with All", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("sessions-filter-codex"));
    expect(screen.getByTestId("session-row-sess-codex")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-row-sess-night")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sessions-filter-all"));
    expect(screen.getByTestId("session-row-sess-night")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-sess-codex")).toBeInTheDocument();
  });

  it("does not fetch night runs until the Night run chip is on", async () => {
    await renderPage();

    const calls = () =>
      (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        (c) => String(c[0]).includes("/build/night-runs")
      );

    expect(calls()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("sessions-filter-night"));
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
  });

  it("filters by ticket text against the epic id and the branch", async () => {
    await renderPage();

    const input = screen.getByPlaceholderText("Filter by ticket");
    fireEvent.change(input, { target: { value: "epic-9" } });

    expect(screen.getByTestId("session-row-sess-night")).toBeInTheDocument();
    expect(screen.queryByTestId("session-row-sess-day")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "arij/feature" } });
    expect(screen.getByTestId("session-row-sess-day")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-row-sess-night")
    ).not.toBeInTheDocument();
  });
});

/**
 * This list is the only durable entry point to a past run's morning summary
 * — the "Night run finished" notification deep link is transient.
 */
describe("SessionsPage — night-run history", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function openNightHistory(runs: unknown[]) {
    mockEndpoints({
      sessions: [agentSession({ id: "sess-day", status: "completed" })],
      nightRuns: runs,
    });
    await renderPage();
    fireEvent.click(screen.getByTestId("sessions-filter-night"));
    return screen.findByTestId("night-runs-list");
  }

  it("stays hidden until the Night run chip is on", async () => {
    mockEndpoints({
      sessions: [agentSession({ id: "sess-day" })],
      nightRuns: [nightRun({})],
    });
    await renderPage();

    expect(screen.queryByTestId("night-runs-list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sessions-filter-night"));
    expect(await screen.findByTestId("night-runs-list")).toBeInTheDocument();
  });

  it("lists past runs with their outcome counts and id", async () => {
    await openNightHistory([
      nightRun({ runId: "night_a41c" }),
      nightRun({ runId: "night_b72d", counts: { done: 1 } }),
    ]);

    const row = await screen.findByTestId("night-run-row-night_a41c");
    expect(row).toHaveTextContent("3 in review, 1 paused, 2 failed");
    expect(row).toHaveTextContent("night_a41c");
    expect(
      await screen.findByTestId("night-run-row-night_b72d")
    ).toHaveTextContent("1 in review");
  });

  it("opens the summary dialog for the clicked run", async () => {
    await openNightHistory([nightRun({ runId: "night_a41c" })]);

    expect(screen.queryByTestId("night-summary-open")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("night-run-row-night_a41c"));

    // Same component, same props as the board's `?nightRun=` deep link.
    expect(screen.getByTestId("night-summary-open")).toHaveTextContent(
      "night_a41c"
    );
  });

  it("flags a live run instead of offering its summary as history", async () => {
    await openNightHistory([
      nightRun({ runId: "night_live", state: "running", endedAt: null }),
    ]);

    expect(
      await screen.findByTestId("night-run-row-night_live")
    ).toHaveTextContent("Running");
  });

  it("says so when the project never ran a night run", async () => {
    await openNightHistory([]);

    expect(
      await screen.findByText("No night runs recorded yet.")
    ).toBeInTheDocument();
  });
});
