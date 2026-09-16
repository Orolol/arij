import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEpicDetail } from "@/hooks/useEpicDetail";

vi.mock("@/hooks/useProjectEvents", () => ({ useProjectEvents: () => ({}) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const response = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const ticket = (id: string, title = id) => ({ id, title, status: "todo" });

beforeEach(() => { vi.restoreAllMocks(); });

afterEach(() => { vi.unstubAllGlobals(); });

describe("ticket detail resource lifetime", () => {
  it("discards a slow previous ticket load after switching tickets", async () => {
    const oldStories = deferred<ReturnType<typeof response>>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/epics/a")) return oldStories.promise;
      if (url.endsWith("/epics/b")) return response({ epic: ticket("b"), userStories: [{ id: "b-story" }] });
      return response(null);
    }));
    const { result, rerender } = renderHook(({ id }) => useEpicDetail("p", id), { initialProps: { id: "a" } });
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.epic?.id).toBe("b"));
    await act(async () => { oldStories.resolve(response({ epic: ticket("a"), userStories: [{ id: "a-story" }] })); });
    expect(result.current.epic?.id).toBe("b");
    expect(result.current.userStories.map((story) => story.id)).toEqual(["b-story"]);
  });

  it("does not show the previous project or ticket while the next load is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/other/")) return new Promise(() => {});
      return response(url.endsWith("/epics/a") ? { epic: ticket("a"), userStories: [] } : null);
    }));
    const { result, rerender } = renderHook(({ project }) => useEpicDetail(project, "a"), { initialProps: { project: "p" } });
    await waitFor(() => expect(result.current.epic?.id).toBe("a"));
    rerender({ project: "other" });
    expect(result.current.epic).toBeNull();
    expect(result.current.userStories).toEqual([]);
  });

  it("clears a ticket removed from a successful refreshed snapshot", async () => {
    let epics = [ticket("a")];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.endsWith("/epics/a") ? { epic: epics[0] ?? null, userStories: [] } : null)));
    const { result } = renderHook(() => useEpicDetail("p", "a"));
    await waitFor(() => expect(result.current.epic?.id).toBe("a"));
    epics = [];
    await act(async () => { await result.current.refresh(); });
    expect(result.current.epic).toBeNull();
  });

  it("keeps the server's accepted update when an earlier refresh arrives late", async () => {
    let holdRefresh = false;
    const stale = deferred<ReturnType<typeof response>>();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return response(ticket("a", "Server title"));
      if (url.endsWith("/epics/a")) return holdRefresh ? stale.promise : response({ epic: ticket("a"), userStories: [] });
      return response([]);
    }));
    const { result } = renderHook(() => useEpicDetail("p", "a"));
    await waitFor(() => expect(result.current.epic?.id).toBe("a"));
    holdRefresh = true;
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await act(async () => { await result.current.updateEpic({ title: "Client title" }); });
    await act(async () => { stale.resolve(response({ epic: ticket("a"), userStories: [] })); await refresh; });
    expect(result.current.epic?.title).toBe("Server title");
  });
});
