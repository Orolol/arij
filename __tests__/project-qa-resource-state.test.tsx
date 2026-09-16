import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjects } from "@/hooks/useProjects";
import { useQaReports } from "@/hooks/useQaReports";
import { usePolledResource } from "@/hooks/usePolledResource";

function json(data: unknown) { return new Response(JSON.stringify({ data })); }
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("project and QA resource reads", () => {
  it("retains project choices and their filter when a refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json([{ id: "active", status: "active" }, { id: "archived", status: "archived" }])).mockRejectedValueOnce(new Error("offline")));
    const { result } = renderHook(() => useProjects());
    await act(async () => {});
    act(() => { result.current.setFilter("active"); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.projects.map((project) => project.id)).toEqual(["active"]);
    expect(result.current.allProjects).toHaveLength(2);
    expect(result.current.error).toBe("Failed to load projects");
  });

  it("treats a non-array project response as an error instead of crashing .filter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({})));
    const { result } = renderHook(() => useProjects());
    await act(async () => {});
    expect(result.current.projects).toEqual([]);
    expect(result.current.error).toBe("Failed to load projects");
  });

  it("does not let an older project read overwrite a confirmed refresh", async () => {
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(json([{ id: "new", status: "active" }])));
    const { result } = renderHook(() => useProjects());
    await act(async () => { await result.current.refresh(); });
    await act(async () => { old.resolve(json([{ id: "old", status: "active" }])); });
    expect(result.current.projects[0]?.id).toBe("new");
  });

  it("keeps QA results scoped while a previous project's read finishes late", async () => {
    const old = deferred();
    const current = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
    const view = renderHook(({ id }) => useQaReports(id), { initialProps: { id: "old" } });
    view.rerender({ id: "current" });
    await act(async () => { old.resolve(json([{ id: "old-report", status: "running" }])); });
    expect(view.result.current.reports).toEqual([]);
    expect(view.result.current.loading).toBe(true);
    await act(async () => { current.resolve(json([{ id: "current-report", status: "completed" }])); });
    expect(view.result.current.reports[0]?.id).toBe("current-report");
  });

  it("starts one QA timer while running and stops it after completion without another initial read", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(json([{ id: "r", status: "running" }])).mockResolvedValueOnce(json([{ id: "r", status: "completed" }]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useQaReports("p"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.reports[0]?.status).toBe("completed");
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not restart a one-shot read when an old mutation refresh callback runs after unmount", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetchMock);
    const errorMessage = () => "failed";
    const view = renderHook(() => usePolledResource("/one-shot", null, errorMessage));
    await act(async () => {});
    const refresh = view.result.current.refresh;
    view.unmount();
    await refresh();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
