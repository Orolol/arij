import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDiff } from "@/hooks/useDiff";
import { useReviewComments, type ReviewComment } from "@/hooks/useReviewComments";
import { useWorktrees } from "@/hooks/useWorktrees";

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
const comment = (id: string, status = "open"): ReviewComment => ({
  id, epicId: "e1", filePath: "a.ts", lineNumber: 1, body: `Comment ${id}`, author: "user", status,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
});
const trees = (count: number) => ({
  worktrees: count ? [{ path: "/repo/tree", branch: "feat", state: "orphan", epicId: null,
    epicReadableId: null, epicTitle: null }] : [], count, orphanCount: count,
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("diff and review resources", () => {
  it("clears the diff on deselection and ignores an old ticket response", async () => {
    const old = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ epicId }) => useDiff("p", epicId), {
      initialProps: { epicId: "a" as string | null },
    });
    rerender({ epicId: null });
    expect(result.current.loading).toBe(false);
    await act(async () => { old.resolve(response({ data: { files: [{ filePath: "old" }] } })); });
    expect(result.current.files).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains the confirmed diff on HTTP failure and ignores an older refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { files: [{ filePath: "a.ts" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDiff("p", "e"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const old = deferred();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ error: "Diff denied" }, 403));
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe("Diff denied");
    expect(result.current.files).toEqual([{ filePath: "a.ts" }]);
    await act(async () => { old.resolve(response({ data: { files: [] } })); await pending; });
    expect(result.current.files).toEqual([{ filePath: "a.ts" }]);
  });

  it("keeps a refused deletion visible and exposes the error", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init) => Promise.resolve(
      init?.method ? response({ error: "Cannot delete" }, 403) : response({ data: [comment("c1")] }),
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReviewComments("p", "e1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.deleteComment("c1")).toBe(false); });
    expect(result.current.comments).toEqual([comment("c1")]);
    expect(result.current.error).toBe("Cannot delete");
    expect(result.current.pending).toBe(false);
  });

  it("locks immediately and a stale GET cannot resurrect a deleted comment", async () => {
    const get = deferred(), mutation = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: [comment("c1")] }))
      .mockReturnValueOnce(get.promise).mockReturnValueOnce(mutation.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReviewComments("p", "e1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let refresh!: Promise<void>, deleting!: Promise<boolean>;
    act(() => { refresh = result.current.refresh(); deleting = result.current.deleteComment("c1"); });
    await act(async () => { expect(await result.current.deleteComment("c1")).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { mutation.resolve(response({ data: { deleted: true } })); await deleting; });
    await act(async () => { get.resolve(response({ data: [comment("c1")] })); await refresh; });
    expect(result.current.comments).toEqual([]);
  });

  it("does not apply an old mutation after A → B → A", async () => {
    const mutation = deferred();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) =>
      init?.method ? mutation.promise : Promise.resolve(response({ data: [comment("c1")] })),
    ));
    const { result, rerender } = renderHook(({ epicId }) => useReviewComments("p", epicId), {
      initialProps: { epicId: "a" },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let deleting!: Promise<boolean>;
    act(() => { deleting = result.current.deleteComment("c1"); });
    rerender({ epicId: "b" }); rerender({ epicId: "a" });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { mutation.resolve(response({ data: { deleted: true } })); expect(await deleting).toBe(false); });
    expect(result.current.comments).toEqual([comment("c1")]);
    expect(result.current.pending).toBe(false);
  });

  it("resolves all comments via the bulk route and marks them resolved, or reports refusal", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: [comment("a"), comment("b"), comment("c")] }))
      .mockResolvedValueOnce(response({ data: { resolved: 3 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReviewComments("p", "e1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.resolveAll()).toBe(true); });
    expect(result.current.comments.map((row) => row.status)).toEqual(["resolved", "resolved", "resolved"]);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("handles refusal on bulk resolveAll", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: [comment("a"), comment("b"), comment("c")] }))
      .mockResolvedValueOnce(response({ error: "Resolve denied" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReviewComments("p", "e1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.resolveAll()).toBe(false); });
    expect(result.current.comments.map((row) => row.status)).toEqual(["open", "open", "open"]);
    expect(result.current.error).toBe("Resolve denied");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a failed initial comments read is unknown and cannot be overwritten", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [] }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReviewComments("p", "e1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBeTruthy();
    await act(async () => { expect(await result.current.addComment("a", 1, "body")).toBeNull(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("worktree resource", () => {
  it("keeps a good listing on failure and hides it when disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: trees(1) }))
      .mockResolvedValueOnce(response({ error: "Offline" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ enabled }) => useWorktrees("p", enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.count).toBe(1));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.count).toBe(1);
    expect(result.current.error).toBe("Offline");
    rerender({ enabled: false });
    expect(result.current.count).toBeNull();
    expect(result.current.worktrees).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("locks pruning and ignores a listing issued before its canonical result", async () => {
    const get = deferred(), post = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: trees(1) }))
      .mockReturnValueOnce(get.promise).mockReturnValueOnce(post.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorktrees("p"));
    await waitFor(() => expect(result.current.count).toBe(1));
    let refreshing!: Promise<void>, pruning!: Promise<void>;
    act(() => { refreshing = result.current.refresh(); pruning = result.current.prune(); });
    await act(async () => { await result.current.prune(); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { post.resolve(response({ data: trees(0) })); await pruning; });
    await act(async () => { get.resolve(response({ data: trees(1) })); await refreshing; });
    expect(result.current.count).toBe(0);
    expect(result.current.pruning).toBe(false);
  });

  it("rejects malformed worktree data instead of inventing an empty repository", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: { worktrees: {} } })));
    const { result } = renderHook(() => useWorktrees("p"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBeNull();
    expect(result.current.error).toBeTruthy();
  });
});
