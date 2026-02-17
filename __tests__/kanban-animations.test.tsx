/**
 * Tests for kanban animation behaviors:
 * - EpicCard highlight prop triggers visual highlight class
 * - Column detects new arrivals and highlights them
 * - Reduced motion preference removes animations
 */

import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { EpicCard } from "@/components/kanban/EpicCard";
import type { KanbanEpic } from "@/lib/types/kanban";

// Mock dnd-kit
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

function makeEpic(overrides?: Partial<KanbanEpic>): KanbanEpic {
  return {
    id: "epic-1",
    projectId: "proj-1",
    title: "Test Epic",
    description: null,
    priority: 0,
    status: "backlog",
    position: 0,
    branchName: null,
    prNumber: null,
    prUrl: null,
    prStatus: null,
    confidence: null,
    evidence: null,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    type: "feature",
    linkedEpicId: null,
    images: null,
    readableId: "E-1",
    usCount: 2,
    usDone: 0,
    ...overrides,
  };
}

describe("EpicCard — highlight animation", () => {
  it("applies highlight classes when highlight=true", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <EpicCard epic={makeEpic()} />
    );

    // Initially no highlight
    const card = container.firstElementChild!;
    expect(card.className).not.toContain("ring-primary/70");

    // Re-render with highlight=true — triggers the useEffect
    rerender(<EpicCard epic={makeEpic()} highlight={true} />);

    // The useEffect sets isHighlighted = true
    expect(card.className).toContain("ring-primary/70");

    // After 1500ms the highlight should clear
    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(card.className).not.toContain("ring-primary/70");
    vi.useRealTimers();
  });

  it("includes motion-reduce classes for accessibility", () => {
    const { container } = render(
      <EpicCard epic={makeEpic()} />
    );

    const card = container.firstElementChild!;
    expect(card.className).toContain("motion-reduce:transition-none");
  });

  it("passes highlight prop without crashing", () => {
    const { container } = render(
      <EpicCard epic={makeEpic()} highlight={false} />
    );

    expect(container.firstElementChild).toBeTruthy();
  });
});
