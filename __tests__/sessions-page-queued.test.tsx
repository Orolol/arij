/**
 * Sessions list page: the synthesis band derived from the loaded sessions
 * (running / today / success rate / queue), the honest empty states, and the
 * client-side filter chips (state, provider, ticket query).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SessionsPage from "@/app/projects/[projectId]/sessions/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
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

function mockSessions(data: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ data }) }))
  );
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
