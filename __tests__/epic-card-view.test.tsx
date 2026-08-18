import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EpicCard } from "@/components/kanban/EpicCard";
import type { KanbanEpic } from "@/lib/types/kanban";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

function makeEpic(overrides: Partial<KanbanEpic> = {}): KanbanEpic {
  return {
    id: "epic-abc123",
    projectId: "proj-1",
    title: "My Epic",
    description: null,
    priority: 1,
    status: "todo",
    position: 0,
    branchName: null,
    prNumber: null,
    prUrl: null,
    prStatus: null,
    confidence: null,
    evidence: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    type: "feature",
    linkedEpicId: null,
    images: null,
    readableId: null,
    releaseId: null,
    usCount: 3,
    usDone: 1,
    ...overrides,
  };
}

describe("EpicCard", () => {
  describe("checkbox removal", () => {
    it("does not render a checkbox button", () => {
      render(
        <EpicCard
          epic={makeEpic()}
          view={{ onToggleSelect: vi.fn(), selected: false }}
        />
      );
      // No checkbox/square button should exist
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("does not contain Square or CheckSquare icons", () => {
      const { container } = render(
        <EpicCard
          epic={makeEpic()}
          view={{ onToggleSelect: vi.fn(), selected: true }}
        />
      );
      // The old checkbox icons had specific classes; ensure no button with those
      expect(container.querySelector("button")).toBeNull();
    });

    it("marks the card as selected", () => {
      const { container } = render(
        <EpicCard epic={makeEpic()} view={{ selected: true }} />
      );
      const card = container.firstChild as HTMLElement;
      expect(card).toHaveAttribute("data-selected", "true");
    });

    it("is not marked selected by default", () => {
      const { container } = render(
        <EpicCard epic={makeEpic()} view={{ selected: false }} />
      );
      const card = container.firstChild as HTMLElement;
      expect(card).not.toHaveAttribute("data-selected");
    });

    it("calls onClick when card is clicked (selection still works)", () => {
      const handleClick = vi.fn();
      const { container } = render(
        <EpicCard epic={makeEpic()} onClick={handleClick} />
      );
      fireEvent.click(container.firstChild as HTMLElement);
      expect(handleClick).toHaveBeenCalledOnce();
    });

    it("uses additive selection on modifier click without triggering primary open", () => {
      const handleClick = vi.fn();
      const handleToggleSelect = vi.fn();
      const { container } = render(
        <EpicCard
          epic={makeEpic()}
          onClick={handleClick}
          view={{ onToggleSelect: handleToggleSelect }}
        />
      );

      fireEvent.click(container.firstChild as HTMLElement, { ctrlKey: true });

      expect(handleToggleSelect).toHaveBeenCalledOnce();
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("awaiting-reply badge", () => {
    it("renders the badge when the view flags awaitingReply", () => {
      render(<EpicCard epic={makeEpic()} view={{ awaitingReply: true }} />);
      const badge = screen.getByTestId("epic-awaiting-reply-epic-abc123");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute(
        "aria-label",
        "Agent asked a question — awaiting your reply"
      );
    });

    it("does not render the badge by default", () => {
      render(<EpicCard epic={makeEpic()} view={{}} />);
      expect(
        screen.queryByTestId("epic-awaiting-reply-epic-abc123")
      ).not.toBeInTheDocument();
    });

    it("coexists with the unreadAi indicator (separate signals)", () => {
      render(
        <EpicCard
          epic={makeEpic()}
          view={{ awaitingReply: true, unreadAi: true }}
        />
      );
      expect(
        screen.getByTestId("epic-awaiting-reply-epic-abc123")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("epic-unread-ai-epic-abc123")
      ).toBeInTheDocument();
    });
  });

  describe("metadata line", () => {
    it("carries the readable id and the story count", () => {
      render(
        <EpicCard
          epic={makeEpic({ readableId: "E-arij-006", usDone: 0, usCount: 3 })}
        />
      );
      const meta = screen.getByTestId("epic-meta-epic-abc123");
      expect(meta.textContent).toContain("E-arij-006");
      expect(meta.textContent).toContain("0/3 US");
    });

    it("falls back to the raw id when the epic has no readable id", () => {
      render(<EpicCard epic={makeEpic({ id: "epic-xyz789", readableId: null })} />);
      expect(screen.getByText("epic-xyz789")).toBeInTheDocument();
    });

    it("replaces the story count with a BUG marker on bug tickets", () => {
      render(<EpicCard epic={makeEpic({ type: "bug" })} />);
      const meta = screen.getByTestId("epic-meta-epic-abc123");
      expect(meta.textContent).toContain("BUG");
      expect(meta.textContent).not.toContain("US");
    });

    it("hides the priority badge at Low and shows it above", () => {
      const { rerender } = render(<EpicCard epic={makeEpic({ priority: 0 })} />);
      expect(screen.queryByText("Low")).not.toBeInTheDocument();

      rerender(<EpicCard epic={makeEpic({ priority: 2 })} />);
      expect(screen.getByText("High")).toBeInTheDocument();
    });

    it("keeps the unread-AI and failure signals reachable", () => {
      render(
        <EpicCard
          epic={makeEpic({ priority: 2, type: "bug" })}
          view={{
            unreadAi: true,
            failedSession: {
              sessionId: "s1",
              error: "timeout",
              agentType: "build",
            },
          }}
        />
      );
      expect(
        screen.getByTestId("epic-unread-ai-epic-abc123")
      ).toBeInTheDocument();
      expect(screen.getByTestId("epic-error-epic-abc123")).toBeInTheDocument();
    });
  });

  describe("title-first layout", () => {
    it("renders the title first, clamped to two lines", () => {
      const { container } = render(
        <EpicCard
          epic={makeEpic({
            title: "A very long title that should be allowed to wrap to two lines",
          })}
        />
      );
      const title = screen.getByText(
        "A very long title that should be allowed to wrap to two lines"
      );
      expect(title.tagName).toBe("H4");
      expect(title.className).toContain("line-clamp-2");
      expect(title.className).not.toContain("truncate");
      // First child of the card: nothing sits above the title any more.
      const card = container.firstChild as HTMLElement;
      expect(card.firstElementChild).toBe(title);
    });

    it("drops the description preview — the card is title + metadata only", () => {
      render(
        <EpicCard
          epic={makeEpic({ description: "This is a description of the epic" })}
        />
      );
      expect(
        screen.queryByText("This is a description of the epic")
      ).not.toBeInTheDocument();
    });
  });
});
