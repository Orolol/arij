import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { EpicCard, isDraftEpic } from "@/components/kanban/EpicCard";
import type { KanbanEpic } from "@/lib/types/kanban";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: { tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: {},
  sortableKeyboardCoordinates: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

function makeEpic(overrides?: Partial<KanbanEpic>): KanbanEpic {
  return {
    id: "epic-1",
    projectId: "proj-1",
    title: "Draft Candidate",
    description: null,
    priority: 1,
    status: "backlog",
    position: 0,
    branchName: null,
    prNumber: null,
    prUrl: null,
    prStatus: null,
    confidence: null,
    evidence: null,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    type: "feature",
    linkedEpicId: null,
    images: null,
    readableId: null,
    releaseId: null,
    usCount: 0,
    usDone: 0,
    ...overrides,
  };
}

describe("isDraftEpic", () => {
  it("is a draft when description is null/empty and there are no stories", () => {
    expect(isDraftEpic({ description: null, usCount: 0 })).toBe(true);
    expect(isDraftEpic({ description: "", usCount: 0 })).toBe(true);
    expect(isDraftEpic({ description: "   ", usCount: 0 })).toBe(true);
  });

  it("is not a draft once it has a description or stories", () => {
    expect(isDraftEpic({ description: "Real spec", usCount: 0 })).toBe(false);
    expect(isDraftEpic({ description: null, usCount: 2 })).toBe(false);
    expect(isDraftEpic({ description: "Real spec", usCount: 2 })).toBe(false);
  });
});

describe("EpicCard draft badge", () => {
  it("shows the draft badge on a card without description or stories", () => {
    render(<EpicCard epic={makeEpic()} />);
    expect(screen.getByTestId("epic-draft-epic-1")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("hides the draft badge when the epic has a description", () => {
    render(<EpicCard epic={makeEpic({ description: "Detailed spec" })} />);
    expect(screen.queryByTestId("epic-draft-epic-1")).not.toBeInTheDocument();
  });

  it("hides the draft badge when the epic has user stories", () => {
    render(<EpicCard epic={makeEpic({ usCount: 3, usDone: 1 })} />);
    expect(screen.queryByTestId("epic-draft-epic-1")).not.toBeInTheDocument();
  });
});
