/**
 * The PIPELINE card's live wiring in the ticket overlay (audit 2026-09-10,
 * lot 05).
 *
 * - #72 the card reads the ticket's registry run through the overlay's own
 *   project-event subscription: a session event re-reads it, no new stream.
 * - #119 the card shows the ticket's queue rank, moves it through POST
 *   …/position, and re-reads the rank on `ticket:updated`.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TicketOverlay } from "@/components/ticket/TicketOverlay";

const mockUseEpicDetail = vi.hoisted(() => vi.fn());
const mockUseAgentDispatch = vi.hoisted(() => vi.fn());
const mockUseEpicDependencies = vi.hoisted(() => vi.fn());
const mockUseProjectEpicsList = vi.hoisted(() => vi.fn());
const mockUseProjects = vi.hoisted(() => vi.fn());
const eventHandlers = vi.hoisted(() => ({
  current: {} as Record<string, (event: unknown) => void>,
}));
const eventState = vi.hoisted(() => ({ pollTick: 0 }));
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
// Stable identities: the fallback-tick effect depends on these refreshers, and
// a fresh vi.fn() per render would re-fire it on every render.
const stableArtifacts = vi.hoisted(() => ({ artifacts: [], error: null, refresh: () => {} }));
vi.mock("@/hooks/useEpicArtifacts", () => ({
  useEpicArtifacts: () => stableArtifacts,
}));
vi.mock("@/hooks/useProjects", () => ({
  useProjects: (...args: unknown[]) => mockUseProjects(...args),
}));
vi.mock("@/hooks/useProjectEvents", () => ({
  useProjectEvents: (_projectId: string, handlers: Record<string, (event: unknown) => void>) => {
    eventHandlers.current = handlers;
    return { status: "connected", pollTick: eventState.pollTick };
  },
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

function setEpicDetail(
  state: {
    loading?: boolean;
    error?: string | null;
    missing?: boolean;
    status?: string;
    stories?: { id: string; title: string }[];
  } = {},
) {
  mockUseEpicDetail.mockImplementation((_projectId: string, epicId: string | null) => ({
    epic:
      state.missing || !epicId
        ? null
        : epicFixture(epicId, state.status ? { status: state.status } : {}),
    userStories: state.stories ?? [],
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


const RUNS_URL = "/api/projects/proj-1/pipeline/runs?epicId=epic-1";
const POSITION_URL = "/api/projects/proj-1/epics/epic-1/position";

let runs: unknown[];
let placement: Record<string, unknown>;
let fetchSpy: ReturnType<typeof vi.fn>;

function calls(url: string, method = "GET") {
  return fetchSpy.mock.calls.filter(
    ([input, init]) => String(input) === url && ((init as RequestInit | undefined)?.method ?? "GET") === method,
  );
}

beforeEach(() => {
  runs = [];
  placement = { status: "review", rank: 2, total: 3, movable: true };
  fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === RUNS_URL) return new Response(JSON.stringify({ data: runs }), { status: 200 });
    if (url === POSITION_URL && init?.method === "POST") {
      placement = { ...placement, rank: 1 };
      return new Response(JSON.stringify({ data: placement }), { status: 200 });
    }
    if (url === POSITION_URL) return new Response(JSON.stringify({ data: placement }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchSpy as unknown as typeof fetch);
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
    predecessors: [],
    successors: [],
    saving: false,
    loading: false,
    ready: true,
    error: null,
    saveDependencies: vi.fn(),
    refresh: vi.fn(),
  });
  mockUseProjectEpicsList.mockReturnValue({ epics: [] });
  mockUseProjects.mockReturnValue({ allProjects: [] });
  eventHandlers.current = {};
  eventState.pollTick = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderOverlay() {
  return render(<TicketOverlay projectId="proj-1" epicId="epic-1" open onClose={vi.fn()} />);
}

function runSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    projectId: "proj-1",
    epicId: "epic-1",
    userStoryId: null,
    state: "running_review",
    stage: "review",
    stageAttempt: 1,
    fixCycles: 1,
    stageMaxAttempts: 2,
    maxFixCycles: 2,
    sessionIds: ["s-1"],
    startedAt: "2026-09-16T10:00:00.000Z",
    endedAt: null,
    reason: null,
    ...overrides,
  };
}

describe("#72 — the PIPELINE card reads the registry", () => {
  it("tells the ticket's active run in words", async () => {
    runs = [runSnapshot()];
    renderOverlay();

    expect(await screen.findByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Running · Review · attempt 1/2 · fix cycle 1/2",
    );
  });

  // A story build registers under its parent's epicId. The parent here sits
  // in to_merge: the story's BUILD must not repaint its chain, and the line
  // names the story instead of passing for the ticket's own run.
  it("does not let a story run drive the parent's chain", async () => {
    setEpicDetail({ status: "to_merge", stories: [{ id: "story-1", title: "Export CSV" }] });
    runs = [
      runSnapshot({
        userStoryId: "story-1",
        state: "running_build",
        stage: "build",
        fixCycles: 0,
        maxFixCycles: 0,
      }),
    ];
    renderOverlay();

    expect(await screen.findByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Running · Build · story Export CSV · attempt 1/2",
    );
    const steps = Array.from(
      screen
        .getByTestId("ticket-pipeline")
        .querySelectorAll("[data-slot=\"pipeline-chain\"] [data-state]"),
    ).map((node) => node.getAttribute("data-state"));
    expect(steps).toEqual(["done", "done", "done", "pending"]);
  });

  it("keeps the column derivation alone when the ticket never ran a pipeline", async () => {
    renderOverlay();
    await waitFor(() => expect(calls(RUNS_URL)).toHaveLength(1));
    expect(screen.queryByTestId("ticket-pipeline-run")).toBeNull();
  });

  it("re-reads the run on the session events the runner already produces", async () => {
    renderOverlay();
    await waitFor(() => expect(calls(RUNS_URL)).toHaveLength(1));

    runs = [runSnapshot({ state: "failed", reason: "session cap reached" })];
    await act(async () => {
      eventHandlers.current["session:started"]?.({ type: "session:started", epicId: "epic-1" });
    });

    expect(await screen.findByTestId("ticket-pipeline-run-reason")).toHaveTextContent(
      "session cap reached",
    );
    expect(screen.getByTestId("ticket-pipeline-run")).toHaveTextContent("Last run failed");

    await act(async () => {
      eventHandlers.current["session:failed"]?.({ type: "session:failed", epicId: "epic-1" });
    });
    await waitFor(() => expect(calls(RUNS_URL)).toHaveLength(3));
  });

  it("ignores another ticket's session events", async () => {
    renderOverlay();
    await waitFor(() => expect(calls(RUNS_URL)).toHaveLength(1));

    await act(async () => {
      eventHandlers.current["session:started"]?.({ type: "session:started", epicId: "epic-9" });
    });
    expect(calls(RUNS_URL)).toHaveLength(1);
  });
});

describe("#119 — manual re-ordering from the PIPELINE card", () => {
  it("shows the rank and moves the ticket through the position route", async () => {
    renderOverlay();

    expect(await screen.findByTestId("ticket-queue")).toHaveTextContent("#2 of 3 in Review");
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));

    await waitFor(() =>
      expect(screen.getByTestId("ticket-queue")).toHaveTextContent("#1 of 3 in Review"),
    );
    const [[, init]] = calls(POSITION_URL, "POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ move: "up" });
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
  });

  it("re-reads the rank on ticket:updated for this ticket", async () => {
    renderOverlay();
    await screen.findByTestId("ticket-queue");
    expect(calls(POSITION_URL)).toHaveLength(1);

    placement = { ...placement, rank: 3 };
    await act(async () => {
      eventHandlers.current["ticket:updated"]?.({ type: "ticket:updated", epicId: "epic-1" });
    });

    await waitFor(() =>
      expect(screen.getByTestId("ticket-queue")).toHaveTextContent("#3 of 3 in Review"),
    );
  });

  // A neighbour created, moved or deleted — by another tab, or by the
  // Refinement MCP tool, which emits nothing for the ticket — changes this
  // ticket's rank and total. A stale "last" would keep down/bottom disabled.
  it.each(["ticket:created", "ticket:moved", "ticket:deleted"])(
    "re-reads the rank when %s fires for another ticket of the project",
    async (type) => {
      renderOverlay();
      await screen.findByTestId("ticket-queue");
      expect(calls(POSITION_URL)).toHaveLength(1);

      placement = { ...placement, total: 4 };
      await act(async () => {
        eventHandlers.current[type]?.({ type, epicId: "epic-7" });
      });

      await waitFor(() =>
        expect(screen.getByTestId("ticket-queue")).toHaveTextContent("#2 of 4 in Review"),
      );
    },
  );

  it("re-reads the rank on the stream's fallback tick", async () => {
    const view = renderOverlay();
    await screen.findByTestId("ticket-queue");
    expect(calls(POSITION_URL)).toHaveLength(1);

    placement = { ...placement, total: 5 };
    eventState.pollTick = 1;
    view.rerender(<TicketOverlay projectId="proj-1" epicId="epic-1" open onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId("ticket-queue")).toHaveTextContent("#2 of 5 in Review"),
    );
  });
});
