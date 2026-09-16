import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUsage } from "@/hooks/useUsage";

function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const response = (marker: string) => ({
  ok: true, json: async () => ({ data: { generatedAt: marker } }),
}) as Response;
afterEach(() => { vi.unstubAllGlobals(); });

describe("usage report request ownership", () => {
  it("uses the current range when an earlier save calls its captured refresh", async () => {
    const fetchMock = vi.fn(async (url: string) => response(url));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUsage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const onSaved = result.current.refresh;
    act(() => { result.current.setRange("7d"); });
    await waitFor(() => expect(result.current.report?.generatedAt).toBe("/api/usage?range=7d"));
    await act(async () => { await onSaved(); });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/usage?range=7d");
    expect(result.current.report?.generatedAt).toBe("/api/usage?range=7d");
  });

  it("cannot overwrite a newly selected range with a slower previous report", async () => {
    const initial = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(initial.promise).mockResolvedValue(response("7d"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUsage());
    act(() => { result.current.setRange("7d"); });
    await waitFor(() => expect(result.current.report?.generatedAt).toBe("7d"));
    await act(async () => { initial.resolve(response("30d")); });
    expect(result.current.report?.generatedAt).toBe("7d");
    expect(result.current.range).toBe("7d");
  });

  it("keeps a fresh refresh loading when an older read fails", async () => {
    const initial = deferred();
    const fresh = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(fresh.promise));
    const { result } = renderHook(() => useUsage());
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refresh({ fresh: true }); });
    await act(async () => { initial.reject(new Error("obsolete")); });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => { fresh.resolve(response("fresh")); await refreshing; });
    expect(result.current.report?.generatedAt).toBe("fresh");
    expect(result.current.loading).toBe(false);
  });
});
