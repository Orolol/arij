import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePolledResource } from "@/hooks/usePolledResource";

const errorMessage = (status?: number) => status ? `HTTP ${status}` : "Read failed";
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("shared desk and QA resource polling", () => {
  it("does not let an invalidated read finish the loading state of a pending refresh", async () => {
    const old = deferred();
    const fresh = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise));
    const { result } = renderHook(() => usePolledResource<string>("/resource", 60000, errorMessage));
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refresh(); });
    await act(async () => { old.resolve(response({ data: "old" })); });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await act(async () => { fresh.resolve(response({ data: "fresh" })); await refreshing; });
    expect(result.current.data).toBe("fresh");
    expect(result.current.loading).toBe(false);
  });

  it("keeps the last successful snapshot and reports a malformed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: "snapshot" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePolledResource<string>("/resource", 60000, errorMessage));
    await waitFor(() => expect(result.current.data).toBe("snapshot"));
    fetchMock.mockResolvedValue(response({}));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.data).toBe("snapshot");
    expect(result.current.error).toBe("Read failed");
  });

  it("ignores responses from an obsolete resource URL", async () => {
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response({ data: "b" })));
    const { result, rerender } = renderHook(
      ({ url }) => usePolledResource<string>(url, 60000, errorMessage),
      { initialProps: { url: "/a" } },
    );
    rerender({ url: "/b" });
    await waitFor(() => expect(result.current.data).toBe("b"));
    await act(async () => { old.resolve(response({ data: "a" })); });
    expect(result.current.data).toBe("b");
  });

  it("ignores an old refresh callback invoked after changing resource", async () => {
    const current = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: "a" })).mockReturnValueOnce(current.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ url }) => usePolledResource<string>(url, 60000, errorMessage),
      { initialProps: { url: "/a" } },
    );
    await waitFor(() => expect(result.current.data).toBe("a"));
    const oldRefresh = result.current.refresh;
    rerender({ url: "/b" });
    await act(async () => { await oldRefresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { current.resolve(response({ data: "b" })); });
    expect(result.current.data).toBe("b");
  });

  it("ignores a discarded StrictMode effect even before the new request completes", async () => {
    const old = deferred();
    const current = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
    const { result } = renderHook(() => usePolledResource<string>("/resource", 60000, errorMessage), { wrapper: StrictMode });
    await act(async () => { old.resolve(response({ data: "discarded" })); });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => { current.resolve(response({ data: "current" })); });
    expect(result.current.data).toBe("current");
  });
});
