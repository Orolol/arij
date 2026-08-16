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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockInboxResponse(items: InboxItem[]) {
    fetchSpy.mockImplementation((url: string) => {
      if (url === "/api/inbox") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: { items, unreadCount: items.length } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
      );
    });
  }

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
});
