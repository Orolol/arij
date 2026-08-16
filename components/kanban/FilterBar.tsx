"use client";

import { Button } from "@/components/ui/button";
import {
  PRIORITY_LABELS,
  type KanbanEpic,
} from "@/lib/types/kanban";
import { Bot, Bug, Focus, Hammer, Lightbulb, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";

/** Client-side kanban card filters. Empty arrays / false flags mean "no filter". */
export interface KanbanFilters {
  /** Ticket types to keep ("feature" / "bug"); empty keeps all */
  types: string[];
  /** Priorities to keep (0-3); empty keeps all */
  priorities: number[];
  /** Keep only epics with an agent currently running */
  agentRunning: boolean;
  /** Keep only epics with an unread AI reply */
  unreadAi: boolean;
  /** Keep only epics whose last agent session failed */
  failedSession: boolean;
}

export const EMPTY_FILTERS: KanbanFilters = {
  types: [],
  priorities: [],
  agentRunning: false,
  unreadAi: false,
  failedSession: false,
};

export function countActiveFilters(filters: KanbanFilters): number {
  return (
    filters.types.length +
    filters.priorities.length +
    (filters.agentRunning ? 1 : 0) +
    (filters.unreadAi ? 1 : 0) +
    (filters.failedSession ? 1 : 0)
  );
}

/** Per-epic live signals the Board already derives, needed to evaluate filters. */
export interface EpicFilterSignals {
  isRunning: boolean;
  unreadAi: boolean;
  hasFailedSession: boolean;
}

/** Pure predicate: does this epic survive the active filters? */
export function epicMatchesFilters(
  epic: Pick<KanbanEpic, "type" | "priority">,
  filters: KanbanFilters,
  signals: EpicFilterSignals
): boolean {
  if (filters.types.length > 0 && !filters.types.includes(epic.type)) {
    return false;
  }
  if (
    filters.priorities.length > 0 &&
    !filters.priorities.includes(epic.priority)
  ) {
    return false;
  }
  if (filters.agentRunning && !signals.isRunning) return false;
  if (filters.unreadAi && !signals.unreadAi) return false;
  if (filters.failedSession && !signals.hasFailedSession) return false;
  return true;
}

/** Parse a persisted filter payload, tolerating malformed or legacy shapes. */
export function parseStoredFilters(raw: string | null): KanbanFilters {
  if (!raw) return EMPTY_FILTERS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_FILTERS;
    const record = parsed as Record<string, unknown>;
    return {
      types: Array.isArray(record.types)
        ? record.types.filter((t): t is string => typeof t === "string")
        : [],
      priorities: Array.isArray(record.priorities)
        ? record.priorities.filter((p): p is number => typeof p === "number")
        : [],
      agentRunning: record.agentRunning === true,
      unreadAi: record.unreadAi === true,
      failedSession: record.failedSession === true,
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}

function FilterChip({ active, onClick, testId, children }: FilterChipProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-accent/50"
      }`}
    >
      {children}
    </button>
  );
}

interface FilterBarProps {
  filters: KanbanFilters;
  onFiltersChange: (filters: KanbanFilters) => void;
  focusMode: boolean;
  onFocusModeChange: (focusMode: boolean) => void;
}

/**
 * Filter chips + focus mode toggle rendered by the Board above the columns.
 * Purely presentational: the Board owns the state and its persistence.
 */
export function FilterBar({
  filters,
  onFiltersChange,
  focusMode,
  onFocusModeChange,
}: FilterBarProps) {
  const activeCount = countActiveFilters(filters);

  function toggleType(type: string) {
    onFiltersChange({
      ...filters,
      types: filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type],
    });
  }

  function togglePriority(priority: number) {
    onFiltersChange({
      ...filters,
      priorities: filters.priorities.includes(priority)
        ? filters.priorities.filter((p) => p !== priority)
        : [...filters.priorities, priority],
    });
  }

  function toggleFlag(
    key: "agentRunning" | "unreadAi" | "failedSession"
  ) {
    onFiltersChange({ ...filters, [key]: !filters[key] });
  }

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap px-4 pt-3"
      data-testid="kanban-filter-bar"
    >
      <FilterChip
        active={filters.types.includes("feature")}
        onClick={() => toggleType("feature")}
        testId="filter-type-feature"
      >
        <Lightbulb className="h-3 w-3" />
        Feature
      </FilterChip>
      <FilterChip
        active={filters.types.includes("bug")}
        onClick={() => toggleType("bug")}
        testId="filter-type-bug"
      >
        <Bug className="h-3 w-3" />
        Bug
      </FilterChip>

      <span className="mx-1 h-4 w-px bg-border" aria-hidden />

      {Object.entries(PRIORITY_LABELS).map(([key, label]) => {
        const priority = Number(key);
        return (
          <FilterChip
            key={key}
            active={filters.priorities.includes(priority)}
            onClick={() => togglePriority(priority)}
            testId={`filter-priority-${key}`}
          >
            {label}
          </FilterChip>
        );
      })}

      <span className="mx-1 h-4 w-px bg-border" aria-hidden />

      <FilterChip
        active={filters.agentRunning}
        onClick={() => toggleFlag("agentRunning")}
        testId="filter-agent-running"
      >
        <Hammer className="h-3 w-3" />
        Agent running
      </FilterChip>
      <FilterChip
        active={filters.unreadAi}
        onClick={() => toggleFlag("unreadAi")}
        testId="filter-unread-ai"
      >
        <Bot className="h-3 w-3" />
        Unread AI
      </FilterChip>
      <FilterChip
        active={filters.failedSession}
        onClick={() => toggleFlag("failedSession")}
        testId="filter-failed-session"
      >
        <TriangleAlert className="h-3 w-3" />
        Failed
      </FilterChip>

      {activeCount > 0 && (
        <>
          <span
            className="text-xs text-muted-foreground ml-1"
            data-testid="filter-active-count"
            title="Drag and drop is disabled while filters are active"
          >
            {activeCount} filter{activeCount > 1 ? "s" : ""} active
          </span>
          <button
            type="button"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="filter-clear-all"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        </>
      )}

      <Button
        size="sm"
        variant={focusMode ? "secondary" : "ghost"}
        onClick={() => onFocusModeChange(!focusMode)}
        className="h-6 text-xs ml-auto"
        aria-pressed={focusMode}
        data-testid="focus-mode-toggle"
      >
        <Focus className="h-3 w-3 mr-1" />
        Focus
      </Button>
    </div>
  );
}
