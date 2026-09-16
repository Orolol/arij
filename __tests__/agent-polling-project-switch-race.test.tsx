import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentPolling } from "@/hooks/useAgentPolling";

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function response(id: string) { return new Response(JSON.stringify({ data: [{ id }] })); }

afterEach(() => { vi.unstubAllGlobals(); });

describe("useAgentPolling", () => {
  it("loads only active sessions, without paging the retired board's failure history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response("active"));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(() => useAgentPolling("p", 100_000));
    await act(async () => {});
    expect(view.result.current.activities.map((activity) => activity.id)).toEqual(["active"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/p/sessions/active");
  });

  it("aborts a previous project's poll and ignores it even if fetch still resolves", async () => {
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response("b"));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(({ projectId }) => useAgentPolling(projectId, 100_000), { initialProps: { projectId: "a" } });
    await act(async () => { view.rerender({ projectId: "b" }); });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response("a")); });
    expect(view.result.current.activities.map((activity) => activity.id)).toEqual(["b"]);
  });

  it("does not let an older same-project read undo a dispatch refresh", async () => {
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response("dispatched"));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(() => useAgentPolling("p", 100_000));
    await act(async () => { await view.result.current.refresh(); });
    await act(async () => { pending.resolve(new Response(JSON.stringify({ data: [] }))); });
    expect(view.result.current.activities.map((activity) => activity.id)).toEqual(["dispatched"]);
  });

  it("keeps running agents visible on an HTTP failure instead of implying completion", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response("running")).mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(() => useAgentPolling("p", 100_000));
    await act(async () => {});
    await act(async () => { await view.result.current.refresh(); });
    expect(view.result.current.activities.map((activity) => activity.id)).toEqual(["running"]);
  });
});
