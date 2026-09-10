/**
 * The overlay's view model and the verification report.
 *
 * `useEpicDetail` fetches `GET …/epics/:id/verify` and returns the parsed
 * report; `useTicketOverlayData` destructured `epic, userStories, loading,
 * updateEpic, refresh, setPolling, gradingReport` and dropped it on the floor,
 * so the report never reached a component. These cases run the REAL
 * `useEpicDetail` under the view model and pin the three halves of the path:
 * the report is exposed, a `ticket:updated` event carrying `verifyStatus`
 * re-reads it, and the manual re-run installs what the route returns.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useTicketOverlayData } from "@/hooks/useTicketOverlayData";
import type { TicketEvent, TicketEventType } from "@/lib/events/bus";
import type { VerificationReport } from "@/lib/verify/verify-constants";

type Handlers = Partial<Record<TicketEventType, (event: TicketEvent) => void>>;

const subscriptions: Handlers[] = [];

vi.mock("@/hooks/useProjectEvents", () => ({
  useProjectEvents: (_projectId: unknown, handlers?: Handlers) => {
    // Both `useEpicDetail` and the view model subscribe; the SSE stream fans
    // one event out to every listener, so the stand-in records them all.
    if (handlers && !subscriptions.includes(handlers)) subscriptions.push(handlers);
    return { status: "connected", pollTick: 0 };
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
  useEpicPr: () => ({
    pr: null,
    loading: false,
    error: null,
    createPr: vi.fn(),
    syncPr: vi.fn(),
  }),
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

function report(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    id: "verify-a",
    projectId: "proj-1",
    epicId: "epic-1",
    agentSessionId: null,
    status: "pass",
    startedAt: "2026-09-08T12:00:00.000Z",
    finishedAt: "2026-09-08T12:00:03.000Z",
    commands: [
      {
        name: "test",
        command: "npm test",
        exitCode: 0,
        durationMs: 1_200,
        tail: "ok\n",
      },
    ],
    ...overrides,
  };
}

/** Newest verify payload the stubbed GET serves; swapped between reads. */
let latest: VerificationReport | null = null;
let postResponse: () => Response;

beforeEach(() => {
  subscriptions.length = 0;
  latest = report();
  postResponse = () =>
    new Response(JSON.stringify({ data: report({ id: "verify-manual" }) }), {
      status: 200,
    });

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/verify")) {
      if (init?.method === "POST") return postResponse();
      return new Response(JSON.stringify({ data: latest }), { status: 200 });
    }
    if (url.endsWith("/epics")) {
      return new Response(
        JSON.stringify({ data: [{ id: "epic-1", title: "T", status: "review" }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderSubject() {
  return renderHook(() => useTicketOverlayData("proj-1", "epic-1", true));
}

function fireTicketUpdated() {
  for (const handlers of [...subscriptions]) {
    handlers["ticket:updated"]?.({
      type: "ticket:updated",
      projectId: "proj-1",
      epicId: "epic-1",
      data: { fields: { verifyReportId: "verify-b", verifyStatus: "fail" } },
      timestamp: new Date().toISOString(),
    });
  }
}

describe("useTicketOverlayData and the verification report", () => {
  it("exposes the report useEpicDetail already fetches", async () => {
    const { result } = renderSubject();

    await waitFor(() => {
      expect(result.current.verificationReport?.id).toBe("verify-a");
    });
    expect(result.current.verificationReport?.commands[0]?.name).toBe("test");
  });

  it("re-reads the report when a ticket:updated event announces a verifyStatus", async () => {
    const { result } = renderSubject();
    await waitFor(() => {
      expect(result.current.verificationReport?.id).toBe("verify-a");
    });

    latest = report({ id: "verify-b", status: "fail" });
    await act(async () => {
      fireTicketUpdated();
    });

    await waitFor(() => {
      expect(result.current.verificationReport?.id).toBe("verify-b");
    });
    expect(result.current.verificationReport?.status).toBe("fail");
  });

  it("runs verification manually and installs the returned report", async () => {
    const { result } = renderSubject();
    await waitFor(() => {
      expect(result.current.verificationReport?.id).toBe("verify-a");
    });

    await act(async () => {
      await result.current.runVerification();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects/proj-1/epics/epic-1/verify",
      { method: "POST" },
    );
    await waitFor(() => {
      expect(result.current.verificationReport?.id).toBe("verify-manual");
    });
    expect(result.current.verifyError).toBeNull();
    expect(result.current.verifyRunning).toBe(false);
  });

  it("keeps the last known report and reports the route's refusal", async () => {
    const { result } = renderSubject();
    await waitFor(() => {
      expect(result.current.verificationReport?.id).toBe("verify-a");
    });

    postResponse = () =>
      new Response(
        JSON.stringify({ error: "Verification is not configured for this project." }),
        { status: 409 },
      );

    await act(async () => {
      await result.current.runVerification();
    });

    expect(result.current.verifyError).toBe(
      "Verification is not configured for this project.",
    );
    // A refused run must not blank the evidence already on screen.
    expect(result.current.verificationReport?.id).toBe("verify-a");
  });
});
