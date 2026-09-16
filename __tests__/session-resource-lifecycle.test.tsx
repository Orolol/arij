import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStreamPager } from "@/components/session-live/useSessionStreamPager";
import { useSessionFiles } from "@/components/session-live/useSessionFiles";
import type { BoundedSessionChunk } from "@/lib/agent-sessions/chunks";

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function json(data: unknown) { return new Response(JSON.stringify({ data })); }
function chunk(sequence: number, content: string): BoundedSessionChunk {
  return { id: `c${sequence}`, sessionId: "a", streamType: "raw", sequence, content, chunkKey: null, createdAt: null, contentLength: content.length, contentOffset: 0, contentTruncated: false };
}
function page(sequence: number, content: string) {
  return { chunks: [chunk(sequence, content)], nextAfter: sequence, hasMore: false };
}
const emptySeed = { chunks: [], nextAfter: null, hasMore: false };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("session stream lifecycle shared by both renderers", () => {
  it("rejects old session pages and releases the new session's cursor immediately", async () => {
    const oldPage = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(json(page(12, "new tail")));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(({ sessionId }) => useSessionStreamPager({
      projectId: "p", sessionId, streamType: "raw", seed: emptySeed, isRunning: false,
    }), { initialProps: { sessionId: "a" } });
    let oldRead!: Promise<void>;
    act(() => { oldRead = view.result.current.loadMore(); });
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    view.rerender({ sessionId: "b" });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { await view.result.current.loadMore(); });
    await act(async () => { oldPage.resolve(json(page(1, "old tail"))); await oldRead; });
    expect(view.result.current.chunks.map((entry) => entry.content)).toEqual(["new tail"]);
    expect(view.result.current.loading).toBe(false);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/sessions/b?");
  });

  it("reads the final response when a run completes between polls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(page(1, "finished answer")));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(({ isRunning }) => useSessionStreamPager({
      projectId: "p", sessionId: "a", streamType: "response", seed: emptySeed, isRunning,
    }), { initialProps: { isRunning: true } });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { view.rerender({ isRunning: false }); });
    expect(view.result.current.chunks.map((entry) => entry.content)).toEqual(["finished answer"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("queues completion behind a pending poll and advances from its returned cursor", async () => {
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json(page(2, "done")));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(({ isRunning }) => useSessionStreamPager({
      projectId: "p", sessionId: "a", streamType: "raw", seed: emptySeed, isRunning,
    }), { initialProps: { isRunning: true } });
    let read!: Promise<void>;
    act(() => { read = view.result.current.loadMore(); });
    view.rerender({ isRunning: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(json(page(1, "working"))); await read; });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("after=1");
    expect(view.result.current.chunks.map((entry) => entry.content)).toEqual(["working", "done"]);
  });

  it("still performs the queued final read when the pending poll fails", async () => {
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json(page(1, "final answer")));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(({ isRunning }) => useSessionStreamPager({
      projectId: "p", sessionId: "a", streamType: "response", seed: emptySeed, isRunning,
    }), { initialProps: { isRunning: true } });
    let read!: Promise<void>;
    act(() => { read = view.result.current.loadMore(); });
    view.rerender({ isRunning: false });
    await act(async () => { pending.resolve(new Response("unavailable", { status: 503 })); await read; });
    expect(view.result.current.chunks.map((entry) => entry.content)).toEqual(["final answer"]);
    expect(view.result.current.error).toBeNull();
  });
});

describe("session files", () => {
  it("queues a final git read if completion arrives during the initial read", async () => {
    const pending = deferred();
    const final = { ticket: null, project: { id: "p", name: "final" }, diff: null };
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json(final));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(({ isRunning }) => useSessionFiles("p", "a", isRunning), { initialProps: { isRunning: true } });
    view.rerender({ isRunning: false });
    await act(async () => { pending.resolve(json({ ...final, project: { id: "p", name: "before completion" } })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.result.current.project?.name).toBe("final");
  });

  it("does not block a completed session's only read behind an abandoned session", async () => {
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json({ ticket: null, project: { id: "p", name: "session B" }, diff: null }));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderHook(({ sessionId }) => useSessionFiles("p", sessionId, false), { initialProps: { sessionId: "a" } });
    await act(async () => { view.rerender({ sessionId: "b" }); });
    expect(view.result.current.project?.name).toBe("session B");
    await act(async () => { pending.resolve(json({ ticket: null, project: { id: "p", name: "session A" }, diff: null })); });
    expect(view.result.current.project?.name).toBe("session B");
    expect(view.result.current.loading).toBe(false);
  });
});
