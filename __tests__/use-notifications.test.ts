import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNotifications } from "@/hooks/useNotifications";

describe("useNotifications", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.title = "Arij";
  });

  function mockFetchResponse(data: unknown[], unreadCount: number) {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data, unreadCount }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  it("fetches notifications on mount", async () => {
    mockFetchResponse(
      [{ id: "n1", title: "Build completed", status: "completed" }],
      1
    );

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unreadCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/notifications?limit=50");
  });

  it("updates document.title when unreadCount > 0", async () => {
    mockFetchResponse([], 3);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(3);
    });

    expect(document.title).toBe("(3) Arij");
  });

  it("resets document.title when unreadCount is 0", async () => {
    document.title = "(5) Arij";
    mockFetchResponse([], 0);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(document.title).toBe("Arij");
  });

  it("markAsRead calls POST and resets unreadCount", async () => {
    mockFetchResponse([{ id: "n1" }], 2);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(2);
    });

    // Now mock the POST response
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await act(async () => {
      await result.current.markAsRead();
    });

    expect(result.current.unreadCount).toBe(0);
    expect(fetchSpy).toHaveBeenCalledWith("/api/notifications/read", {
      method: "POST",
    });
  });

  it("handles fetch errors gracefully", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useNotifications());

    // Should not throw — silently swallows errors
    // Wait a tick so the effect runs
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });
});
