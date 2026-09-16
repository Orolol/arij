/**
 * The PIPELINE card's two readers (audit 2026-09-10, lot 05).
 *
 * - #72 `useTicketPipelineRun` reads ONE ticket's registry runs and polls
 *   only while one of them is active; an idle ticket costs one GET.
 * - #119 `useTicketQueuePosition` reads the ticket's place in its column,
 *   moves it through POST …/position, surfaces a refusal as a sentence, and
 *   re-reads when the ticket changes column.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TICKET_PIPELINE_RUN_POLL_MS,
  useTicketPipelineRun,
} from "@/hooks/usePipelineRuns";
import { useTicketQueuePosition } from "@/hooks/useTicketQueuePosition";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function snapshot(state: string) {
  return {
    runId: "run-1",
    projectId: "proj-1",
    epicId: "epic-1",
    userStoryId: null,
    state,
    stage: "review",
    stageAttempt: 1,
    fixCycles: 0,
    sessionIds: ["s-1"],
    startedAt: "2026-09-16T10:00:00.000Z",
    endedAt: null,
    reason: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useTicketPipelineRun", () => {
  it("asks the route for this ticket's runs only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [snapshot("succeeded")] }));
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketPipelineRun("proj-1", "epic-1"));

    await waitFor(() => expect(hook.result.current.run?.state).toBe("succeeded"));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/projects/proj-1/pipeline/runs?epicId=epic-1",
    );
  });

  it("does not poll a ticket whose runs are all over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [snapshot("failed")] }));
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketPipelineRun("proj-1", "epic-1"));
    await waitFor(() => expect(hook.result.current.run?.state).toBe("failed"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKET_PIPELINE_RUN_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls slowly while a run is active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [snapshot("running_review")] }));
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketPipelineRun("proj-1", "epic-1"));
    await waitFor(() => expect(hook.result.current.run?.state).toBe("running_review"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKET_PIPELINE_RUN_POLL_MS + 50);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("reads nothing without a ticket", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderHook(() => useTicketPipelineRun("proj-1", null));
    expect(hook.result.current.run).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const PLACEMENT = { status: "todo", rank: 3, total: 7, movable: true };

describe("useTicketQueuePosition", () => {
  it("reads the ticket's placement in its column", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: PLACEMENT }));
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketQueuePosition("proj-1", "epic-1", "todo"));

    await waitFor(() => expect(hook.result.current.placement).toEqual(PLACEMENT));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/projects/proj-1/epics/epic-1/position",
    );
  });

  it("POSTs the move and shows the placement the server answers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: PLACEMENT }))
      .mockResolvedValueOnce(json({ data: { ...PLACEMENT, rank: 2 } }));
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketQueuePosition("proj-1", "epic-1", "todo"));
    await waitFor(() => expect(hook.result.current.placement?.rank).toBe(3));

    await act(async () => {
      await hook.result.current.move("up");
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("/api/projects/proj-1/epics/epic-1/position");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ move: "up" });
    expect(hook.result.current.placement?.rank).toBe(2);
    expect(hook.result.current.moving).toBe(false);
    expect(hook.result.current.error).toBeNull();
  });

  it("is moving while the POST is in flight", async () => {
    let resolvePost!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: PLACEMENT }))
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolvePost = resolve; }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketQueuePosition("proj-1", "epic-1", "todo"));
    await waitFor(() => expect(hook.result.current.placement).not.toBeNull());

    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.move("bottom");
    });
    expect(hook.result.current.moving).toBe(true);

    await act(async () => {
      resolvePost(json({ data: { ...PLACEMENT, rank: 7 } }));
      await pending;
    });
    expect(hook.result.current.moving).toBe(false);
  });

  it("keeps the placement and names the refusal when the move fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: PLACEMENT }))
      .mockResolvedValueOnce(json({ error: "Cannot reorder done tickets" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketQueuePosition("proj-1", "epic-1", "todo"));
    await waitFor(() => expect(hook.result.current.placement).not.toBeNull());

    await act(async () => {
      await hook.result.current.move("down");
    });

    expect(hook.result.current.error).toBe("Cannot reorder done tickets");
    expect(hook.result.current.placement).toEqual(PLACEMENT);
    expect(hook.result.current.moving).toBe(false);
  });

  it("re-reads when the ticket changes column, and hides the stale rank meanwhile", async () => {
    let resolveSecond!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: PLACEMENT }))
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveSecond = resolve; }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(
      ({ status }) => useTicketQueuePosition("proj-1", "epic-1", status),
      { initialProps: { status: "todo" } },
    );
    await waitFor(() => expect(hook.result.current.placement).not.toBeNull());

    hook.rerender({ status: "in_progress" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(hook.result.current.placement).toBeNull();

    await act(async () => {
      resolveSecond(json({ data: { status: "in_progress", rank: 1, total: 2, movable: true } }));
    });
    await waitFor(() => expect(hook.result.current.placement?.status).toBe("in_progress"));
  });

  it("clears an earlier refusal on the next move", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: PLACEMENT }))
      .mockResolvedValueOnce(json({ error: "nope" }, 500))
      .mockResolvedValueOnce(json({ data: { ...PLACEMENT, rank: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useTicketQueuePosition("proj-1", "epic-1", "todo"));
    await waitFor(() => expect(hook.result.current.placement).not.toBeNull());

    await act(async () => {
      await hook.result.current.move("top");
    });
    expect(hook.result.current.error).toBe("nope");

    await act(async () => {
      await hook.result.current.move("top");
    });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.placement?.rank).toBe(1);
  });
});
