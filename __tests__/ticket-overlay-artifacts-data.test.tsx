/**
 * The overlay's view model and the ticket's visual proofs.
 *
 * `GET …/epics/:id/artifacts` lost its only reader when the old EpicDetail
 * panel went (7fec5315). These cases pin the restored path end to end under
 * the real `useTicketOverlayData`: the list is read on open, re-read when an
 * `artifact:created` event names this ticket (and only this ticket), a failed
 * read surfaces as a message with a working retry, and the overlay mounts the
 * band that draws it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";

import { useTicketOverlayData } from "@/hooks/useTicketOverlayData";
import { TicketOverlay } from "@/components/ticket/TicketOverlay";
import type { TicketEvent, TicketEventType } from "@/lib/events/bus";
import type { SessionArtifactSummary } from "@/lib/agent-sessions/artifact-view";

type Handlers = Partial<Record<TicketEventType, (event: TicketEvent) => void>>;

const subscriptions: Handlers[] = [];
// The SSE fallback counter `useProjectEvents` bumps while the stream is down.
let pollTick = 0;

vi.mock("@/hooks/useProjectEvents", () => ({
  useProjectEvents: (_projectId: unknown, handlers?: Handlers) => {
    if (handlers && !subscriptions.includes(handlers)) subscriptions.push(handlers);
    return { status: pollTick > 0 ? "disconnected" : "connected", pollTick };
  },
}));
vi.mock("@/hooks/useTicketComments", () => ({
  useTicketComments: () => ({ comments: [], loading: false, addComment: vi.fn() }),
}));
vi.mock("@/hooks/useAgentDispatch", () => ({
  useAgentDispatch: () => ({
    activeSession: null,
    dispatching: false,
    isRunning: false,
    sendToDev: vi.fn(),
    sendToReview: vi.fn(),
    sendToGrading: vi.fn(),
    resolveMerge: vi.fn(),
    refreshSessions: vi.fn(),
  }),
}));
vi.mock("@/hooks/useEpicMutations", () => ({
  useEpicMutations: () => ({
    merging: false,
    mergeError: null,
    mergeConflict: false,
    conflictFiles: undefined,
    setMergeError: vi.fn(),
    merge: vi.fn(),
    deletingEpic: false,
    deleteEpicError: null,
    deleteEpic: vi.fn(),
  }),
}));
vi.mock("@/hooks/useEpicDependencies", () => ({
  useEpicDependencies: () => ({
    predecessors: [],
    successors: [],
    saving: false,
    error: null,
    saveDependencies: vi.fn(),
  }),
}));
vi.mock("@/hooks/useEpicPr", () => ({
  useEpicPr: () => ({ pr: null, loading: false, error: null, createPr: vi.fn(), syncPr: vi.fn() }),
}));
vi.mock("@/hooks/useGitHubConfig", () => ({
  useGitHubConfig: () => ({ isConfigured: false }),
}));
vi.mock("@/hooks/useProjectEpicsList", () => ({
  useProjectEpicsList: () => ({ epics: [] }),
}));
vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [] }),
}));
vi.mock("@/hooks/useEpicActivity", () => ({
  useEpicActivity: () => ({ entries: [], refresh: vi.fn() }),
}));
vi.mock("@/lib/agent-sessions/session-list", () => ({
  findUnifiedSession: vi.fn().mockResolvedValue(null),
}));

const ARTIFACTS_URL = "/api/projects/proj-1/epics/epic-1/artifacts";

function artifact(id: string, caption = `Proof ${id}`): SessionArtifactSummary {
  return {
    id,
    agentSessionId: "sess-1",
    epicId: "epic-1",
    caption,
    createdAt: "2026-09-10T12:00:00.000Z",
  };
}

let artifacts: SessionArtifactSummary[] = [];
let artifactsStatus = 200;
// When set, the next artifacts read waits on it: lets a case observe the UI
// while a retry is still in flight.
let artifactsGate: Promise<void> | null = null;

beforeEach(() => {
  subscriptions.length = 0;
  pollTick = 0;
  artifacts = [artifact("a1")];
  artifactsStatus = 200;
  artifactsGate = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === ARTIFACTS_URL) {
      if (artifactsGate) await artifactsGate;
      return artifactsStatus === 200
        ? new Response(JSON.stringify({ data: artifacts }), { status: 200 })
        : // No error body: the hook's own catalogue message is what shows.
          new Response("{}", { status: artifactsStatus });
    }
    if (url.endsWith("/epics/epic-1")) {
      return new Response(
        JSON.stringify({
          // The detail route's real shape: the overlay renders no band
          // until `data.epic` is there.
          data: {
            epic: { id: "epic-1", title: "T", status: "review" },
            userStories: [],
            gradingReport: null,
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ data: null }), { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function artifactReads(): number {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => String(input) === ARTIFACTS_URL).length;
}

function fireArtifactCreated(epicId: string) {
  // Every render hands `useProjectEvents` a fresh handler object and the real
  // hook dispatches to the newest one only, so only the last one fires here.
  for (const handlers of subscriptions.slice(-1)) {
    handlers["artifact:created"]?.({
      type: "artifact:created",
      projectId: "proj-1",
      epicId,
      data: { sessionId: "sess-1", artifactId: "a2" },
      timestamp: new Date().toISOString(),
    });
  }
}

describe("useTicketOverlayData and the visual proofs", () => {
  it("reads the ticket's artifacts on open", async () => {
    const { result } = renderHook(() => useTicketOverlayData("proj-1", "epic-1", true));

    await waitFor(() => {
      expect(result.current.artifacts.map((row) => row.id)).toEqual(["a1"]);
    });
    expect(result.current.artifactsError).toBeNull();
  });

  it("does not read anything while the overlay is closed", async () => {
    renderHook(() => useTicketOverlayData("proj-1", "epic-1", false));
    await act(async () => {});
    expect(artifactReads()).toBe(0);
  });

  it("re-reads when artifact:created names this ticket, and ignores other tickets", async () => {
    const { result } = renderHook(() => useTicketOverlayData("proj-1", "epic-1", true));
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1));
    const readsBefore = artifactReads();

    await act(async () => {
      fireArtifactCreated("epic-other");
    });
    expect(artifactReads()).toBe(readsBefore);

    artifacts = [artifact("a1"), artifact("a2")];
    await act(async () => {
      fireArtifactCreated("epic-1");
    });

    await waitFor(() => {
      expect(result.current.artifacts.map((row) => row.id)).toEqual(["a1", "a2"]);
    });
  });

  it("surfaces a failed read and recovers through the retry", async () => {
    artifactsStatus = 500;
    const { result } = renderHook(() => useTicketOverlayData("proj-1", "epic-1", true));

    await waitFor(() => {
      expect(result.current.artifactsError).toBe("Failed to load visual proofs");
    });

    artifactsStatus = 200;
    await act(async () => {
      await result.current.refreshArtifacts();
    });

    expect(result.current.artifactsError).toBeNull();
    expect(result.current.artifacts.map((row) => row.id)).toEqual(["a1"]);
  });

  it("keeps the error on screen while a retry that fails again is in flight", async () => {
    artifactsStatus = 500;
    const { result } = renderHook(() => useTicketOverlayData("proj-1", "epic-1", true));
    await waitFor(() => {
      expect(result.current.artifactsError).toBe("Failed to load visual proofs");
    });

    let release!: () => void;
    artifactsGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let retry!: Promise<void>;
    await act(async () => {
      retry = result.current.refreshArtifacts();
    });
    // Mid-read: a null here would unmount the band, and the Retry under the
    // cursor with it, until the read settles.
    expect(result.current.artifactsError).toBe("Failed to load visual proofs");

    artifactsGate = null;
    await act(async () => {
      release();
      await retry;
    });
    expect(result.current.artifactsError).toBe("Failed to load visual proofs");
  });

  it("the Retry button stays mounted, and focused, during its own read", async () => {
    artifactsStatus = 500;
    render(<TicketOverlay projectId="proj-1" epicId="epic-1" open onClose={vi.fn()} />);
    const retry = await screen.findByTestId("ticket-artifacts-retry");
    retry.focus();

    let release!: () => void;
    artifactsGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await act(async () => {
      retry.click();
    });
    expect(retry.isConnected).toBe(true);
    expect(document.activeElement).toBe(retry);

    artifactsGate = null;
    await act(async () => {
      release();
    });
    expect(screen.getByTestId("ticket-artifacts-retry")).toBe(retry);
  });

  it("re-reads on the SSE fallback tick, so a proof attached while the stream is down still shows", async () => {
    const { result, rerender } = renderHook(() =>
      useTicketOverlayData("proj-1", "epic-1", true),
    );
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1));
    const readsBefore = artifactReads();

    artifacts = [artifact("a1"), artifact("a2")];
    pollTick = 1;
    await act(async () => {
      rerender();
    });

    await waitFor(() => {
      expect(result.current.artifacts.map((row) => row.id)).toEqual(["a1", "a2"]);
    });
    expect(artifactReads()).toBe(readsBefore + 1);
  });

  it("a host refresh bump does not re-read the proofs a second time", async () => {
    // On /projects/:id the page bumps refreshTrigger on the very
    // `artifact:created` the overlay already handles; reading on both paths
    // spent two GETs per screenshot.
    const { result, rerender } = renderHook(
      ({ trigger }) =>
        useTicketOverlayData("proj-1", "epic-1", true, { refreshTrigger: trigger }),
      { initialProps: { trigger: 0 } },
    );
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1));
    const readsBefore = artifactReads();

    await act(async () => {
      rerender({ trigger: 1 });
      fireArtifactCreated("epic-1");
    });

    await waitFor(() => expect(artifactReads()).toBe(readsBefore + 1));
    await act(async () => {});
    expect(artifactReads()).toBe(readsBefore + 1);
  });

  it("the overlay mounts the band with the proofs it read", async () => {
    render(<TicketOverlay projectId="proj-1" epicId="epic-1" open onClose={vi.fn()} />);

    const band = await screen.findByTestId("ticket-artifacts-band");
    expect(band).toHaveTextContent("Proof a1");
    expect(screen.getByAltText("Proof a1")).toHaveAttribute(
      "src",
      "/api/projects/proj-1/artifacts/a1",
    );
  });
});
