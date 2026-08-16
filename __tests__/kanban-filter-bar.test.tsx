import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FilterBar,
  EMPTY_FILTERS,
  countActiveFilters,
  epicMatchesFilters,
  parseStoredFilters,
  type KanbanFilters,
} from "@/components/kanban/FilterBar";

const noSignals = { isRunning: false, unreadAi: false, hasFailedSession: false };

function filters(overrides?: Partial<KanbanFilters>): KanbanFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

describe("epicMatchesFilters", () => {
  const featureP2 = { type: "feature", priority: 2 };
  const bugP0 = { type: "bug", priority: 0 };

  it("matches everything when no filter is active", () => {
    expect(epicMatchesFilters(featureP2, EMPTY_FILTERS, noSignals)).toBe(true);
    expect(epicMatchesFilters(bugP0, EMPTY_FILTERS, noSignals)).toBe(true);
  });

  it("filters by type", () => {
    const f = filters({ types: ["bug"] });
    expect(epicMatchesFilters(featureP2, f, noSignals)).toBe(false);
    expect(epicMatchesFilters(bugP0, f, noSignals)).toBe(true);
  });

  it("filters by priority (multi-select)", () => {
    const f = filters({ priorities: [0, 3] });
    expect(epicMatchesFilters(featureP2, f, noSignals)).toBe(false);
    expect(epicMatchesFilters(bugP0, f, noSignals)).toBe(true);
  });

  it("filters by agent-running / unread-AI / failed-session signals", () => {
    expect(
      epicMatchesFilters(featureP2, filters({ agentRunning: true }), noSignals)
    ).toBe(false);
    expect(
      epicMatchesFilters(featureP2, filters({ agentRunning: true }), {
        ...noSignals,
        isRunning: true,
      })
    ).toBe(true);
    expect(
      epicMatchesFilters(featureP2, filters({ unreadAi: true }), {
        ...noSignals,
        unreadAi: true,
      })
    ).toBe(true);
    expect(
      epicMatchesFilters(featureP2, filters({ failedSession: true }), noSignals)
    ).toBe(false);
    expect(
      epicMatchesFilters(featureP2, filters({ failedSession: true }), {
        ...noSignals,
        hasFailedSession: true,
      })
    ).toBe(true);
  });

  it("combines filters with AND semantics", () => {
    const f = filters({ types: ["feature"], priorities: [2], unreadAi: true });
    expect(epicMatchesFilters(featureP2, f, noSignals)).toBe(false);
    expect(
      epicMatchesFilters(featureP2, f, { ...noSignals, unreadAi: true })
    ).toBe(true);
    expect(
      epicMatchesFilters(bugP0, f, { ...noSignals, unreadAi: true })
    ).toBe(false);
  });
});

describe("countActiveFilters / parseStoredFilters", () => {
  it("counts every active chip", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(
      countActiveFilters(
        filters({ types: ["bug"], priorities: [1, 2], failedSession: true })
      )
    ).toBe(4);
  });

  it("parses persisted filters and tolerates malformed payloads", () => {
    const stored = filters({ types: ["feature"], priorities: [3], unreadAi: true });
    expect(parseStoredFilters(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredFilters(null)).toEqual(EMPTY_FILTERS);
    expect(parseStoredFilters("not-json{")).toEqual(EMPTY_FILTERS);
    expect(parseStoredFilters('"just a string"')).toEqual(EMPTY_FILTERS);
    expect(
      parseStoredFilters(
        JSON.stringify({ types: [42, "bug"], priorities: ["3", 1], unreadAi: "yes" })
      )
    ).toEqual(filters({ types: ["bug"], priorities: [1] }));
  });
});

describe("FilterBar", () => {
  function renderBar(current: KanbanFilters = EMPTY_FILTERS, focusMode = false) {
    const onFiltersChange = vi.fn();
    const onFocusModeChange = vi.fn();
    render(
      <FilterBar
        filters={current}
        onFiltersChange={onFiltersChange}
        focusMode={focusMode}
        onFocusModeChange={onFocusModeChange}
      />
    );
    return { onFiltersChange, onFocusModeChange };
  }

  it("toggles a type chip on", () => {
    const { onFiltersChange } = renderBar();
    fireEvent.click(screen.getByTestId("filter-type-bug"));
    expect(onFiltersChange).toHaveBeenCalledWith(filters({ types: ["bug"] }));
  });

  it("toggles an already-active priority chip off", () => {
    const { onFiltersChange } = renderBar(filters({ priorities: [1, 3] }));
    fireEvent.click(screen.getByTestId("filter-priority-3"));
    expect(onFiltersChange).toHaveBeenCalledWith(filters({ priorities: [1] }));
  });

  it("toggles signal chips", () => {
    const { onFiltersChange } = renderBar();
    fireEvent.click(screen.getByTestId("filter-agent-running"));
    expect(onFiltersChange).toHaveBeenCalledWith(filters({ agentRunning: true }));
  });

  it("shows the active filter count and clears all", () => {
    const active = filters({ types: ["feature"], unreadAi: true });
    const { onFiltersChange } = renderBar(active);

    expect(screen.getByTestId("filter-active-count")).toHaveTextContent(
      "2 filters active"
    );

    fireEvent.click(screen.getByTestId("filter-clear-all"));
    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });

  it("hides count and clear-all when nothing is active", () => {
    renderBar();
    expect(screen.queryByTestId("filter-active-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("filter-clear-all")).not.toBeInTheDocument();
  });

  it("toggles focus mode", () => {
    const { onFocusModeChange } = renderBar(EMPTY_FILTERS, true);
    const toggle = screen.getByTestId("focus-mode-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(onFocusModeChange).toHaveBeenCalledWith(false);
  });
});
