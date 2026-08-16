import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InboxPage from "@/app/inbox/page";
import type { InboxItem } from "@/hooks/useInbox";

const mockInboxState = vi.hoisted(() => ({
  items: [] as unknown[],
  loading: false,
  markRead: vi.fn(),
  reply: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/hooks/useInbox", () => ({
  useInbox: () => ({
    items: mockInboxState.items,
    unreadCount: mockInboxState.items.length,
    loading: mockInboxState.loading,
    markRead: mockInboxState.markRead,
    reply: mockInboxState.reply,
    refresh: mockInboxState.refresh,
  }),
}));

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    epicId: "e1",
    projectId: "p1",
    projectName: "Alpha",
    readableId: "E-alpha-001",
    title: "Fix login flow",
    status: "in_progress",
    type: "feature",
    awaitingReply: true,
    unread: false,
    latestCommentAuthor: "agent",
    latestCommentExcerpt: "Which auth provider should I wire up?",
    latestCommentCreatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    lastReadAt: null,
    ...overrides,
  };
}

describe("Inbox page", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    mockInboxState.items = [];
    mockInboxState.loading = false;
    mockInboxState.markRead = vi.fn().mockResolvedValue(undefined);
    mockInboxState.reply = vi.fn().mockResolvedValue(undefined);
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the empty state when nothing is waiting", () => {
    render(<InboxPage />);
    expect(screen.getByTestId("inbox-empty")).toBeInTheDocument();
  });

  it("groups rows by project, preserving the server order", () => {
    mockInboxState.items = [
      makeItem({ epicId: "e1", projectId: "p1", projectName: "Alpha" }),
      makeItem({
        epicId: "e2",
        projectId: "p2",
        projectName: "Beta",
        awaitingReply: false,
        unread: true,
      }),
      makeItem({ epicId: "e3", projectId: "p1", projectName: "Alpha" }),
    ];

    render(<InboxPage />);

    const groups = screen.getAllByTestId(/inbox-project-group-/);
    expect(groups.map((g) => g.getAttribute("data-testid"))).toEqual([
      "inbox-project-group-p1",
      "inbox-project-group-p2",
    ]);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // Both p1 rows live under the p1 group.
    expect(groups[0]).toContainElement(screen.getByTestId("inbox-item-e1"));
    expect(groups[0]).toContainElement(screen.getByTestId("inbox-item-e3"));
    expect(screen.getByTestId("inbox-count")).toHaveTextContent("3 waiting");
  });

  it("renders excerpt, age, awaiting badge, and the ticket deep link", () => {
    mockInboxState.items = [makeItem()];

    render(<InboxPage />);

    expect(
      screen.getByText("Which auth provider should I wire up?")
    ).toBeInTheDocument();
    expect(screen.getByText(/agent · 5m ago/)).toBeInTheDocument();
    expect(screen.getByTestId("inbox-awaiting-badge-e1")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-item-link-e1")).toHaveAttribute(
      "href",
      "/projects/p1?ticket=e1"
    );
    expect(screen.getByText("E-alpha-001")).toBeInTheDocument();
  });

  it("hides the awaiting badge for plain unread rows", () => {
    mockInboxState.items = [
      makeItem({ awaitingReply: false, unread: true }),
    ];

    render(<InboxPage />);

    expect(
      screen.queryByTestId("inbox-awaiting-badge-e1")
    ).not.toBeInTheDocument();
  });

  it("sends an inline reply through the hook and clears the textarea", async () => {
    mockInboxState.items = [makeItem()];

    render(<InboxPage />);

    const input = screen.getByTestId("inbox-reply-input-e1");
    fireEvent.change(input, { target: { value: "Use OAuth please" } });
    fireEvent.click(screen.getByTestId("inbox-reply-send-e1"));

    await waitFor(() => {
      expect(mockInboxState.reply).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "p1", epicId: "e1" }),
        "Use OAuth please"
      );
    });
    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("surfaces reply errors inline", async () => {
    mockInboxState.items = [makeItem()];
    mockInboxState.reply = vi
      .fn()
      .mockRejectedValue(new Error("Epic not found"));

    render(<InboxPage />);

    fireEvent.change(screen.getByTestId("inbox-reply-input-e1"), {
      target: { value: "hello?" },
    });
    fireEvent.click(screen.getByTestId("inbox-reply-send-e1"));

    await waitFor(() => {
      expect(screen.getByTestId("inbox-item-error-e1")).toHaveTextContent(
        "Epic not found"
      );
    });
  });

  it("Send to Dev POSTs the existing build route with the typed comment and marks read", async () => {
    mockInboxState.items = [makeItem({ status: "in_progress" })];
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { sessionId: "s1" } }), {
        status: 200,
      })
    );

    render(<InboxPage />);

    fireEvent.change(screen.getByTestId("inbox-reply-input-e1"), {
      target: { value: "Go ahead with OAuth" },
    });
    fireEvent.click(screen.getByTestId("inbox-send-to-dev-e1"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/projects/p1/epics/e1/build",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ comment: "Go ahead with OAuth" }),
        })
      );
    });
    await waitFor(() => {
      expect(mockInboxState.markRead).toHaveBeenCalledWith("e1");
    });
  });

  it("surfaces the 409 concurrency error from the build route", async () => {
    mockInboxState.items = [makeItem()];
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Another agent is already running for this epic.",
        }),
        { status: 409 }
      )
    );

    render(<InboxPage />);

    fireEvent.click(screen.getByTestId("inbox-send-to-dev-e1"));

    await waitFor(() => {
      expect(screen.getByTestId("inbox-item-error-e1")).toHaveTextContent(
        "Another agent is already running for this epic."
      );
    });
    expect(mockInboxState.markRead).not.toHaveBeenCalled();
  });

  it("offers no Send to Dev shortcut for non-buildable statuses", () => {
    mockInboxState.items = [makeItem({ status: "done" })];

    render(<InboxPage />);

    expect(
      screen.queryByTestId("inbox-send-to-dev-e1")
    ).not.toBeInTheDocument();
    // The deep link into the ticket remains the path for those rows.
    expect(screen.getByTestId("inbox-item-link-e1")).toBeInTheDocument();
  });
});
