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

    it("applies ring-2 ring-primary class when selected", () => {
      const { container } = render(
        <EpicCard epic={makeEpic()} view={{ selected: true }} />
      );
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain("ring-2");
      expect(card.className).toContain("ring-primary");
    });

    it("does not apply ring classes when not selected", () => {
      const { container } = render(
        <EpicCard epic={makeEpic()} view={{ selected: false }} />
      );
      const card = container.firstChild as HTMLElement;
      expect(card.className).not.toContain("ring-2");
      expect(card.className).not.toContain("ring-primary");
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

  describe("epic ID display", () => {
    it("displays the epic ID above the title in monospace text", () => {
      render(<EpicCard epic={makeEpic({ id: "epic-xyz789" })} />);
      const idEl = screen.getByText("epic-xyz789");
      expect(idEl).toBeInTheDocument();
      expect(idEl.tagName).toBe("SPAN");
      expect(idEl.className).toContain("font-mono");
      expect(idEl.className).toContain("text-xs");
      expect(idEl.className).toContain("text-muted-foreground");
    });
  });

  describe("description preview", () => {
    it("renders description when present", () => {
      render(
        <EpicCard
          epic={makeEpic({ description: "This is a description of the epic" })}
        />
      );
      const desc = screen.getByText("This is a description of the epic");
      expect(desc).toBeInTheDocument();
      expect(desc.className).toContain("line-clamp-2");
      expect(desc.className).toContain("text-xs");
      expect(desc.className).toContain("text-muted-foreground");
    });

    it("does not render description when null", () => {
      render(<EpicCard epic={makeEpic({ description: null })} />);
      // Only the title and ID text should exist, no <p> for description
      expect(screen.queryByText("", { selector: "p" })).not.toBeInTheDocument();
    });

    it("does not render description when empty string", () => {
      render(<EpicCard epic={makeEpic({ description: "" })} />);
      const paragraphs = document.querySelectorAll("p");
      expect(paragraphs).toHaveLength(0);
    });
  });

  describe("two-row layout: title and badges on separate rows", () => {
    it("renders the title with line-clamp-2 instead of truncate", () => {
      render(<EpicCard epic={makeEpic({ title: "A very long title that should be allowed to wrap to two lines" })} />);
      const title = screen.getByText("A very long title that should be allowed to wrap to two lines");
      expect(title.tagName).toBe("H4");
      expect(title.className).toContain("line-clamp-2");
      expect(title.className).not.toContain("truncate");
    });

    it("renders badges in a wrapping flex container below the title", () => {
      const { container } = render(
        <EpicCard
          epic={makeEpic({ priority: 2, type: "bug" })}
          view={{
            unreadAi: true,
            failedSession: { sessionId: "s1", error: "timeout", epicId: "e1" },
          }}
        />
      );
      // Find the badges row by its flex-wrap class
      const badgesRow = container.querySelector(".flex-wrap");
      expect(badgesRow).not.toBeNull();
      // It should contain the priority badge, bug badge, AI update and error indicators
      expect(badgesRow!.querySelector("[data-testid='epic-unread-ai-epic-abc123']")).not.toBeNull();
      expect(badgesRow!.querySelector("[data-testid='epic-error-epic-abc123']")).not.toBeNull();
      expect(badgesRow!.textContent).toContain("High");
      expect(badgesRow!.textContent).toContain("Bug");
    });

    it("title and badges are not on the same flex row", () => {
      const { container } = render(
        <EpicCard epic={makeEpic()} />
      );
      // The old layout used justify-between on the parent to put title and badges side-by-side
      // The new layout should NOT have justify-between on the parent wrapper
      const card = container.firstChild as HTMLElement;
      const firstDiv = card.querySelector("div");
      expect(firstDiv!.className).not.toContain("justify-between");
    });
  });
});
