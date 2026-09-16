/**
 * The ticket overlay's wiring to its hosts (audit 2026-09-10, lot 05).
 *
 * - #120 a BLOCKS / WAITS ON chip opens that ticket;
 * - #122 a 409 AGENT_ALREADY_RUNNING is never swallowed, and the provider
 *   (the only overlay host on `/`, `/tickets`, `/qa`, `/chat`) gives merge,
 *   delete and conflict a visible outcome;
 * - #133 a ticket can be opened straight onto its diff;
 * - #134 no band paints fallback values before the ticket arrives, and the
 *   project chip reads the shared project list — no GET per open — with the
 *   desk's creation-order colour rule.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import { TicketOverlay } from "@/components/ticket/TicketOverlay";
import {
  TicketOverlayProvider,
  useTicketOverlay,
  type OpenTicketOptions,
} from "@/components/ticket/TicketOverlayProvider";

const mockUseEpicDetail = vi.hoisted(() => vi.fn());
const mockUseAgentDispatch = vi.hoisted(() => vi.fn());
const mockUseEpicDependencies = vi.hoisted(() => vi.fn());
const mockUseProjectEpicsList = vi.hoisted(() => vi.fn());
const mockUseProjects = vi.hoisted(() => vi.fn());
const mutationOptions = vi.hoisted(() => ({
  current: {} as { onMergeSuccess?: () => void; onDeleteSuccess?: () => void },
}));

vi.mock("@/hooks/useEpicDetail", () => ({
  useEpicDetail: (...args: unknown[]) => mockUseEpicDetail(...args),
}));
vi.mock("@/hooks/useTicketComments", () => ({
  useTicketComments: () => ({ comments: [], loading: false, addComment: vi.fn() }),
}));
vi.mock("@/hooks/useAgentDispatch", () => ({
  useAgentDispatch: (...args: unknown[]) => mockUseAgentDispatch(...args),
}));
vi.mock("@/hooks/useEpicMutations", () => ({
  useEpicMutations: (
    _projectId: string,
    _epicId: string | null,
    options: { onMergeSuccess?: () => void; onDeleteSuccess?: () => void },
  ) => {
    mutationOptions.current = options;
    return {
      merging: false,
      mergeError: null,
      mergeConflict: false,
      conflictFiles: undefined,
      setMergeError: vi.fn(),
      merge: vi.fn(),
      deletingEpic: false,
      deleteEpicError: null,
      deleteEpic: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useEpicPr", () => ({
  useEpicPr: () => ({ pr: null, loading: false, ready: true, error: null, createPr: vi.fn(), syncPr: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/hooks/useGitHubConfig", () => ({
  useGitHubConfig: () => ({ isConfigured: false }),
}));
vi.mock("@/hooks/useEpicDependencies", () => ({
  useEpicDependencies: (...args: unknown[]) => mockUseEpicDependencies(...args),
}));
vi.mock("@/hooks/useProjectEpicsList", () => ({
  useProjectEpicsList: (...args: unknown[]) => mockUseProjectEpicsList(...args),
}));
vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [] }),
}));
vi.mock("@/hooks/useEpicActivity", () => ({
  useEpicActivity: () => ({ entries: [], refresh: vi.fn() }),
}));
vi.mock("@/hooks/useEpicArtifacts", () => ({
  useEpicArtifacts: () => ({ artifacts: [], error: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useProjects", () => ({
  useProjects: (...args: unknown[]) => mockUseProjects(...args),
}));
vi.mock("@/hooks/useProjectEvents", () => ({
  useProjectEvents: () => ({ status: "connected", pollTick: 0 }),
}));
vi.mock("@/lib/agent-sessions/session-list", () => ({
  findUnifiedSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/components/review/DiffViewer", () => ({
  DiffViewer: ({ epicId }: { epicId: string }) => (
    <div data-testid="diff-viewer">{epicId}</div>
  ),
}));
vi.mock("@/components/shared/AgentDispatchDialog", () => ({
  AgentDispatchDialog: () => null,
}));
vi.mock("@/components/chat/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

function epicFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title of ${id}`,
    description: null,
    priority: 2,
    status: "review",
    branchName: null,
    prNumber: null,
    prUrl: null,
    prStatus: null,
    type: "feature",
    linkedEpicId: null,
    images: null,
    readableId: id === "epic-1" ? "ARJ-1" : "ARJ-2",
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function setEpicDetail(state: { loading?: boolean; error?: string | null; missing?: boolean } = {}) {
  mockUseEpicDetail.mockImplementation((_projectId: string, epicId: string | null) => ({
    epic: state.missing || !epicId ? null : epicFixture(epicId),
    userStories: [],
    gradingReport: null,
    verificationReport: null,
    loading: state.loading ?? false,
    error: state.error ?? null,
    updateEpic: vi.fn().mockResolvedValue({ ok: true }),
    refresh: vi.fn(),
    setVerificationReport: vi.fn(),
    setPolling: vi.fn(),
  }));
}

function conflictError() {
  return Object.assign(new Error("An agent is already running on this ticket"), {
    code: "AGENT_ALREADY_RUNNING",
    activeSessionId: "sess-9",
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchSpy);
  setEpicDetail();
  mockUseAgentDispatch.mockReturnValue({
    activeSession: null,
    dispatching: false,
    isRunning: false,
    sendToDev: vi.fn(),
    sendToReview: vi.fn(),
    sendToGrading: vi.fn(),
    resolveMerge: vi.fn(),
    refreshSessions: vi.fn(),
  });
  mockUseEpicDependencies.mockReturnValue({
    predecessors: [{ ticketId: "epic-1", dependsOnTicketId: "epic-2" }],
    successors: [],
    saving: false,
    loading: false,
    ready: true,
    error: null,
    saveDependencies: vi.fn(),
    refresh: vi.fn(),
  });
  mockUseProjectEpicsList.mockReturnValue({
    epics: [{ id: "epic-2", readableId: "ARJ-2", title: "Waited on" }],
  });
  // `proj-1` is the SECOND project by creation order, so the desk paints it
  // in tone 2 — a hash of its id would not land there by construction.
  mockUseProjects.mockReturnValue({
    allProjects: [
      { id: "proj-1", name: "Piscine", createdAt: "2026-02-01T00:00:00.000Z" },
      { id: "zz-older", name: "Older", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  });
  mutationOptions.current = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderOverlay(overrides?: Partial<ComponentProps<typeof TicketOverlay>>) {
  return render(
    <TicketOverlay projectId="proj-1" epicId="epic-1" open onClose={vi.fn()} {...overrides} />,
  );
}

function Opener({ epicId = "epic-1", options }: { epicId?: string; options?: OpenTicketOptions }) {
  const { openTicket } = useTicketOverlay();
  return (
    <button type="button" onClick={() => openTicket(epicId, { projectId: "proj-1", ...options })}>
      open ticket
    </button>
  );
}

function renderProvider(options?: OpenTicketOptions) {
  render(
    <TicketOverlayProvider>
      <Opener options={options} />
    </TicketOverlayProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "open ticket" }));
}

function headerChips() {
  return within(screen.getByTestId("ticket-overlay-header"));
}

/* ------------------------------------------------------------------ */

describe("#120 — dependency chips navigate", () => {
  it("hands a WAITS ON chip's ticket to the host", () => {
    const onOpenTicket = vi.fn();
    renderOverlay({ onOpenTicket });

    fireEvent.click(screen.getByRole("button", { name: /ARJ-2/ }));

    expect(onOpenTicket).toHaveBeenCalledWith("epic-2");
  });

  it("swaps the provider's overlay onto the clicked ticket", async () => {
    renderProvider();
    expect(screen.getByRole("heading", { name: "Title of epic-1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ARJ-2/ }));

    expect(await screen.findByRole("heading", { name: "Title of epic-2" })).toBeInTheDocument();
    expect(mockUseEpicDetail).toHaveBeenLastCalledWith("proj-1", "epic-2");
  });
});

describe("#122 — conflicts and outcomes are never silent", () => {
  it("shows a 409 in the pipeline card when the host gives no conflict sink", async () => {
    mockUseAgentDispatch.mockReturnValue({
      activeSession: null,
      dispatching: false,
      isRunning: false,
      sendToDev: vi.fn(),
      sendToReview: vi.fn().mockRejectedValue(conflictError()),
      sendToGrading: vi.fn(),
      resolveMerge: vi.fn(),
      refreshSessions: vi.fn(),
    });
    renderOverlay();

    fireEvent.click(screen.getByTestId("ticket-review-now"));

    expect(await screen.findByTestId("ticket-status-error")).toHaveTextContent(
      "An agent is already running on this ticket",
    );
  });

  it("raises the provider's conflict toast with a link to the session in the way", async () => {
    mockUseAgentDispatch.mockReturnValue({
      activeSession: null,
      dispatching: false,
      isRunning: false,
      sendToDev: vi.fn(),
      sendToReview: vi.fn().mockRejectedValue(conflictError()),
      sendToGrading: vi.fn(),
      resolveMerge: vi.fn(),
      refreshSessions: vi.fn(),
    });
    renderProvider();

    fireEvent.click(screen.getByTestId("ticket-review-now"));

    const toast = await screen.findByTestId("ticket-overlay-toast");
    expect(toast).toHaveTextContent("An agent is already running on this ticket");
    expect(within(toast).getByRole("link")).toHaveAttribute(
      "href",
      "/projects/proj-1/sessions/sess-9",
    );
  });

  it("confirms a merge after the overlay closes", async () => {
    renderProvider();

    act(() => mutationOptions.current.onMergeSuccess?.());

    expect(screen.queryByTestId("epic-detail-panel")).not.toBeInTheDocument();
    expect(await screen.findByTestId("ticket-overlay-toast")).toHaveTextContent(/merged/i);
  });

  it("confirms a deletion after the overlay closes", async () => {
    renderProvider();

    act(() => mutationOptions.current.onDeleteSuccess?.());

    expect(screen.queryByTestId("epic-detail-panel")).not.toBeInTheDocument();
    expect(await screen.findByTestId("ticket-overlay-toast")).toHaveTextContent(/deleted/i);
  });
});

describe("#122 — one toast stack per route", () => {
  // The screens under the provider raise into this instead of drawing a
  // second stack in the same fixed corner.
  it("exposes its stack to the screen under it", async () => {
    function Raiser() {
      const { raiseToast } = useTicketOverlay();
      return (
        <button type="button" onClick={() => raiseToast?.("error", "Poll failed")}>
          raise
        </button>
      );
    }
    render(
      <TicketOverlayProvider>
        <Raiser />
      </TicketOverlayProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "raise" }));
    expect(await screen.findByTestId("ticket-overlay-toast")).toHaveTextContent("Poll failed");
  });

  it("has no stack to offer outside a provider", () => {
    function Probe() {
      const { raiseToast } = useTicketOverlay();
      return <span data-testid="probe">{raiseToast === null ? "none" : "some"}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
  });
});

describe("#133 — opening straight onto the diff", () => {
  it("starts on the diff when the host asks for it", () => {
    renderOverlay({ initialView: "diff" });
    expect(screen.getByTestId("diff-viewer")).toHaveTextContent("epic-1");
  });

  it("starts on the ticket by default", () => {
    renderOverlay();
    expect(screen.queryByTestId("diff-viewer")).not.toBeInTheDocument();
  });

  it("carries `view: \"diff\"` through the provider", () => {
    renderProvider({ view: "diff" });
    expect(screen.getByTestId("diff-viewer")).toBeInTheDocument();
  });
});

describe("#134 — before the ticket arrives, and the project chip", () => {
  it("paints no band with fallback values while the ticket loads", () => {
    setEpicDetail({ loading: true, missing: true });
    renderOverlay();

    expect(screen.getByRole("heading", { name: "…" })).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-status-control")).not.toBeInTheDocument();
    expect(screen.getByTestId("ticket-overlay-pending")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("epic-detail-panel")).not.toHaveTextContent("Loading...");
  });

  it("says why when the ticket cannot be read", () => {
    setEpicDetail({ loading: false, missing: true, error: "Epic not found" });
    renderOverlay();

    expect(screen.getByTestId("ticket-overlay-pending")).toHaveTextContent("Epic not found");
    expect(screen.queryByTestId("ticket-status-control")).not.toBeInTheDocument();
  });

  // /qa unfiltered used to open a run's ticket with no owner: no project means
  // no URL, so nothing loads and nothing fails — "…" would have promised a
  // load that never comes, to sighted users and screen readers alike.
  it("says the ticket cannot open without a project, instead of pretending to load", () => {
    setEpicDetail({ loading: false, missing: true });
    renderOverlay({ projectId: "" });

    const pending = screen.getByTestId("ticket-overlay-pending");
    expect(pending).toHaveTextContent("This ticket cannot be opened: its project is unknown");
    expect(pending).toHaveAttribute("aria-busy", "false");
    expect(pending).not.toHaveTextContent("Opening ticket");
  });

  it("is busy only while the read is in flight", () => {
    setEpicDetail({ loading: false, missing: true, error: "Epic not found" });
    renderOverlay();
    expect(screen.getByTestId("ticket-overlay-pending")).toHaveAttribute("aria-busy", "false");
  });

  it("names and colours the project from the shared list, without a GET per open", async () => {
    renderOverlay();

    const chip = headerChips().getByText("PISCINE").closest("[data-tone]");
    // Creation order: zz-older is 0, proj-1 is 1 → tone 2.
    expect(chip).toHaveAttribute("data-tone", "2");
    await waitFor(() => expect(mockUseProjects).toHaveBeenCalled());
    const projectReads = fetchSpy.mock.calls.filter(([input]) =>
      String(input) === "/api/projects/proj-1",
    );
    expect(projectReads).toEqual([]);
  });
});
