import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useInbox, type InboxItem } from "@/hooks/useInbox";

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    epicId: "e1",
    projectId: "p1",
    projectName: "Alpha",
    readableId: "E-alpha-001",
    title: "Fix login",
    status: "in_progress",
    type: "feature",
    awaitingReply: true,
    unread: false,
    latestCommentAuthor: "agent",
    latestCommentExcerpt: "Which auth provider should I use?",
    latestCommentCreatedAt: "2026-08-16T09:00:00.000Z",
    lastReadAt: null,
    ...overrides,
  };
}

describe("useInbox", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The route's real payload shape: the row count the bar badge reads, plus
  // the two category counters (app/api/inbox/route.ts).
  function mockInboxResponse(items: InboxItem[]) {
    fetchSpy.mockImplementation((url: string) => {
      if (url === "/api/inbox") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                items,
                unreadCount: items.length,
                unreadMessageCount: items.filter((i) => i.unread).length,
                awaitingReplyCount: items.filter((i) => i.awaitingReply).length,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
      );
    });
  }

  it("adopts a clamped page so new messages cannot send the reader back to a removed page", async () => {
    let totalPages = 2;
    fetchSpy.mockImplementation((url: string) => {
      const requested = Number(new URL(url, "http://localhost").searchParams.get("page") ?? 1);
      const page = Math.min(requested, totalPages);
      return Promise.resolve(new Response(JSON.stringify({ data: {
        items: [makeItem({ epicId: `page-${page}` })], unreadCount: totalPages,
        unreadMessageCount: totalPages, awaitingReplyCount: 0,
        pagination: { page, pageSize: 1, totalPages },
      } })));
    });
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.items[0]?.epicId).toBe("page-2"));

    totalPages = 1;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.page).toBe(1);
      expect(fetchSpy).toHaveBeenLastCalledWith("/api/inbox");
    });

    totalPages = 2;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.items[0].epicId).toBe("page-1");
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/inbox");
  });

  it("fetches the inbox on mount", async () => {
    mockInboxResponse([makeItem()]);

    const { result } = renderHook(() => useInbox());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.unreadCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/inbox");
  });

  it("forwards the unread and awaiting counters apart from the row count", async () => {
    mockInboxResponse([
      // An unread report on a finished ticket — nobody is held on a reply.
      makeItem({ epicId: "e-done", status: "done", awaitingReply: false, unread: true }),
      // A question already opened but never answered — awaiting, not unread.
      makeItem({ epicId: "e-q", awaitingReply: true, unread: false }),
    ]);

    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unreadCount).toBe(2);
    expect(result.current.unreadMessageCount).toBe(1);
    expect(result.current.awaitingReplyCount).toBe(1);
  });

  it("falls back to zero counters when the payload omits them", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [makeItem()] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.unreadMessageCount).toBe(0);
    expect(result.current.awaitingReplyCount).toBe(0);
  });

  it("markRead POSTs the epic id and re-fetches the inbox", async () => {
    mockInboxResponse([makeItem()]);

    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchSpy.mockClear();
    mockInboxResponse([]);

    await act(async () => {
      await result.current.markRead("e1");
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ epicId: "e1" }),
    });
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/inbox");
    expect(result.current.items).toEqual([]);
  });

  it("reply posts a user comment on the epic's comments route, then marks read", async () => {
    mockInboxResponse([makeItem()]);

    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchSpy.mockClear();
    mockInboxResponse([]);

    await act(async () => {
      await result.current.reply(
        { projectId: "p1", epicId: "e1" },
        "Use OAuth please"
      );
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/p1/epics/e1/comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", content: "Use OAuth please" }),
      }
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/inbox/read",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reply throws when the comments route returns an error", async () => {
    mockInboxResponse([makeItem()]);
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Epic not found" }), { status: 404 })
    );

    await expect(
      act(async () => {
        await result.current.reply(
          { projectId: "p1", epicId: "gone" },
          "hello?"
        );
      })
    ).rejects.toThrow("Epic not found");
  });

  it("handles fetch errors gracefully", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useInbox());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });
  it("settles initial loading and exposes HTTP failures", async () => {
    fetchSpy.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load the inbox.");
  });

  it("rejects a failed read cursor without claiming a successful refresh", async () => {
    mockInboxResponse([makeItem()]);
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Cursor refused" }), { status: 500 }));
    await act(async () => {
      await expect(result.current.markRead("e1")).rejects.toThrow("Cursor refused");
    });
    expect(result.current.items).toHaveLength(1);
  });

  it("keeps a confirmed reply successful if only the read cursor fails", async () => {
    mockInboxResponse([makeItem()]);
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "reply" } })))
      .mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await result.current.reply(makeItem(), "My answer"); });
    expect(result.current.error).toBe("Failed to mark as read");
    expect(fetchSpy.mock.calls.filter(([url]: [string]) => url.endsWith("/comments"))).toHaveLength(1);
  });

  it("does not resurrect a read item when a stale polling request completes", async () => {
    let finishOld!: (response: Response) => void;
    fetchSpy.mockReturnValueOnce(new Promise<Response>((resolve) => { finishOld = resolve; }));
    const { result } = renderHook(() => useInbox());
    mockInboxResponse([]);
    await act(async () => { await result.current.markRead("e1"); });
    await act(async () => {
      finishOld(new Response(JSON.stringify({ data: { items: [makeItem()], unreadCount: 1 } })));
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it("ignores an older page and refreshes the visible page after a late mark-read", async () => {
    let finishFirst!: (response: Response) => void;
    let finishRead!: (response: Response) => void;
    fetchSpy.mockImplementation((url: string) => {
      if (url === "/api/inbox") return new Promise<Response>((resolve) => { finishFirst = resolve; });
      if (url === "/api/inbox/read") return new Promise<Response>((resolve) => { finishRead = resolve; });
      return Promise.resolve(new Response(JSON.stringify({ data: { items: [makeItem({ epicId: "second-page" })], unreadCount: 51,
        pagination: { page: 2, pageSize: 50, totalPages: 2 } } })));
    });
    const { result } = renderHook(() => useInbox());
    let markRead!: Promise<void>;
    act(() => { markRead = result.current.markRead("e1"); result.current.setPage(2); });
    await waitFor(() => expect(result.current.items[0]?.epicId).toBe("second-page"));
    await act(async () => {
      finishFirst(new Response(JSON.stringify({ data: { items: [makeItem()], unreadCount: 51 } })));
      finishRead(new Response(JSON.stringify({ data: { ok: true } })));
      await markRead;
    });
    expect(result.current.page).toBe(2);
    expect(result.current.items[0].epicId).toBe("second-page");
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/inbox?page=2");
  });

  it("asks only for summary metadata when used by the global badge", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { items: [], unreadCount: 500 } })));
    const { result } = renderHook(() => useInbox({ summaryOnly: true }));
    await waitFor(() => expect(result.current.unreadCount).toBe(500));
    expect(fetchSpy).toHaveBeenCalledWith("/api/inbox?summary=1");
  });

});
