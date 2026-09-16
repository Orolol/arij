import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEpicDependencies } from "@/hooks/useEpicDependencies";
import { useEpicPr } from "@/hooks/useEpicPr";
import { useGitStatus } from "@/hooks/useGitStatus";

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
const edge = (id: string) => ({ id, ticketId: "e", dependsOnTicketId: id, projectId: "p",
  scopeType: "project", scopeId: "p", createdAt: "2026-01-01" });
const pr = { id: "pr1", number: 42, projectId: "p", epicId: "e", status: "open",
  url: "https://github.com/acme/repo/pull/42", title: "PR", headBranch: "feat", baseBranch: "main" };
afterEach(() => { vi.unstubAllGlobals(); });

describe("Git hook mutations", () => {
  it("does not allow replacing dependencies when their initial read failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: "Dependencies unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEpicDependencies("p", "e"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBe("Dependencies unavailable");
    await act(async () => { expect(await result.current.saveDependencies([])).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("commits canonical dependency records without a second GET and rejects duplicate saves", async () => {
    const put = deferred(), get = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: { predecessors: [], successors: [edge("successor")] } }))
      .mockReturnValueOnce(put.promise).mockReturnValueOnce(get.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEpicDependencies("p", "e"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let saving!: Promise<boolean>, reading!: Promise<void>;
    act(() => { saving = result.current.saveDependencies(["new"]); reading = result.current.refresh(); });
    await act(async () => { expect(await result.current.saveDependencies(["other"])).toBe(false); });
    await act(async () => { put.resolve(response({ data: [edge("new")] })); expect(await saving).toBe(true); });
    await act(async () => { get.resolve(response({ data: { predecessors: [], successors: [] } })); await reading; });
    expect(result.current.predecessors).toEqual([edge("new")]);
    expect(result.current.successors).toEqual([edge("successor")]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retains dependencies and reports a refused PUT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ data: { predecessors: [edge("a")], successors: [] } }))
      .mockResolvedValueOnce(response({ error: "Cycle detected" }, 422)));
    const { result } = renderHook(() => useEpicDependencies("p", "e"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.saveDependencies(["b"])).toBe(false); });
    expect(result.current.predecessors).toEqual([edge("a")]);
    expect(result.current.error).toBe("Cycle detected");
  });

  it("treats a successful null PR as known but a refused read as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: null }))
      .mockResolvedValueOnce(response({ data: null }, 403));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ epicId }) => useEpicPr("p", epicId), { initialProps: { epicId: "a" } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.pr).toBeNull();
    expect(result.current.error).toBeNull();
    rerender({ epicId: "b" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBeTruthy();
    await act(async () => { expect(await result.current.createPr()).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prevents duplicate PR creation and does not lose the created PR to a late read", async () => {
    const post = deferred(), get = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: null }))
      .mockReturnValueOnce(post.promise).mockReturnValueOnce(get.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEpicPr("p", "e"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let creating!: Promise<boolean>, reading!: Promise<void>;
    act(() => { creating = result.current.createPr(); reading = result.current.refresh(); });
    await act(async () => { expect(await result.current.createPr()).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { post.resolve(response({ data: { pr } }, 201)); expect(await creating).toBe(true); });
    await act(async () => { get.resolve(response({ data: null })); await reading; });
    expect(result.current.pr).toEqual(pr);
    expect(result.current.loading).toBe(false);
  });

  it("cannot apply PR creation to another ticket or a second visit to the original ticket", async () => {
    const post = deferred();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) => init?.method
      ? post.promise : Promise.resolve(response({ data: null }))));
    const { result, rerender } = renderHook(({ epicId }) => useEpicPr("p", epicId), { initialProps: { epicId: "a" } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let creating!: Promise<boolean>;
    act(() => { creating = result.current.createPr(); });
    rerender({ epicId: "b" }); rerender({ epicId: "a" });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { post.resolve(response({ data: { pr } })); expect(await creating).toBe(false); });
    expect(result.current.pr).toBeNull();
  });

  it("keeps a push scoped to its branch and locks duplicate requests immediately", async () => {
    const post = deferred();
    const fetchMock = vi.fn().mockImplementation((url, init) => init?.method ? post.promise
      : Promise.resolve(response({ data: { ahead: String(url).endsWith("branch=a") ? 5 : 2, behind: 0 } })));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ branch }) => useGitStatus("p", branch, true), { initialProps: { branch: "a" } });
    await waitFor(() => expect(result.current.ahead).toBe(5));
    let pushing!: Promise<void>;
    act(() => { pushing = result.current.push(); });
    await act(async () => { await result.current.push(); });
    rerender({ branch: "b" });
    await waitFor(() => expect(result.current.ahead).toBe(2));
    await act(async () => { post.resolve(response({ data: { pushed: true } })); await pushing; });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.ahead).toBe(2);
    expect(result.current.pushing).toBe(false);
  });

  it("invalidates a pre-push read when the push requests its final status", async () => {
    const old = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: { ahead: 5, behind: 0 } }))
      .mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ data: { pushed: true } }))
      .mockResolvedValueOnce(response({ data: { ahead: 0, behind: 0 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useGitStatus("p", "a", true));
    await waitFor(() => expect(result.current.ahead).toBe(5));
    let reading!: Promise<void>;
    act(() => { reading = result.current.refresh(); });
    await act(async () => { await result.current.push(); });
    await act(async () => { old.resolve(response({ data: { ahead: 5, behind: 0 } })); await reading; });
    expect(result.current.ahead).toBe(0);
  });
});
