import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InboxNavLink } from "@/components/layout/InboxNavLink";

const mockInboxState = vi.hoisted(() => ({
  unreadCount: 0,
}));

vi.mock("@/hooks/useInbox", () => ({
  useInbox: () => ({
    items: [],
    unreadCount: mockInboxState.unreadCount,
    loading: false,
    markRead: vi.fn(),
    reply: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("InboxNavLink (sidebar)", () => {
  beforeEach(() => {
    mockInboxState.unreadCount = 0;
  });

  it("links to the inbox page", () => {
    render(<InboxNavLink />);
    expect(screen.getByTestId("sidebar-inbox-link")).toHaveAttribute(
      "href",
      "/inbox"
    );
  });

  it("shows no badge when nothing is waiting", () => {
    render(<InboxNavLink />);
    expect(screen.queryByTestId("sidebar-inbox-badge")).not.toBeInTheDocument();
  });

  it("shows the waiting count as a badge", () => {
    mockInboxState.unreadCount = 3;
    render(<InboxNavLink />);
    expect(screen.getByTestId("sidebar-inbox-badge")).toHaveTextContent("3");
  });

  it("caps the badge at 99+", () => {
    mockInboxState.unreadCount = 120;
    render(<InboxNavLink />);
    expect(screen.getByTestId("sidebar-inbox-badge")).toHaveTextContent("99+");
  });
});
