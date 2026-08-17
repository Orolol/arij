"use client";

import { cn } from "@/lib/utils";
import {
  PRIORITY_LABELS,
  type KanbanEpic,
} from "@/lib/types/kanban";
import { Focus, X } from "lucide-react";
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
  /** "bug" tints the inactive pill with the bug colour, as in the mockups. */
  tone?: "default" | "bug";
  children: ReactNode;
}

function FilterChip({
  active,
  onClick,
  testId,
  tone = "default",
  children,
}: FilterChipProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-[11px] py-[3px] text-[12.5px] transition-colors motion-reduce:transition-none",
        active
          ? "bg-foreground text-background"
          : cn(
              "border border-border hover:bg-band",
              tone === "bug" ? "text-destructive" : "text-muted-foreground"
            )
      )}
    >
      {children}
    </button>
  );
}

function ChipDivider() {
  return <span className="mx-[5px] h-4 w-px shrink-0 bg-border" aria-hidden />;
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
      className="flex h-[44px] shrink-0 items-center gap-[7px] overflow-x-auto border-b border-border px-[22px]"
      data-testid="kanban-filter-bar"
    >
      <FilterChip
        active={activeCount === 0}
        onClick={() => onFiltersChange(EMPTY_FILTERS)}
        testId="filter-all"
      >
        All
      </FilterChip>

      <FilterChip
        active={filters.types.includes("feature")}
        onClick={() => toggleType("feature")}
        testId="filter-type-feature"
      >
        Feature
      </FilterChip>
      <FilterChip
        active={filters.types.includes("bug")}
        onClick={() => toggleType("bug")}
        testId="filter-type-bug"
        tone="bug"
      >
        Bug
      </FilterChip>

      <ChipDivider />

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

      <ChipDivider />

      <FilterChip
        active={filters.agentRunning}
        onClick={() => toggleFlag("agentRunning")}
        testId="filter-agent-running"
      >
        Agent running
      </FilterChip>
      <FilterChip
        active={filters.unreadAi}
        onClick={() => toggleFlag("unreadAi")}
        testId="filter-unread-ai"
      >
        Unread AI
      </FilterChip>
      <FilterChip
        active={filters.failedSession}
        onClick={() => toggleFlag("failedSession")}
        testId="filter-failed-session"
      >
        Failed
      </FilterChip>

      {activeCount > 0 && (
        <>
          <span
            className="ml-[5px] shrink-0 text-[12px] text-meta"
            data-testid="filter-active-count"
            title="Drag and drop is disabled while filters are active"
          >
            {activeCount} filter{activeCount > 1 ? "s" : ""} active {"·"} drag
            disabled
          </span>
          <button
            type="button"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="inline-flex shrink-0 items-center gap-[4px] text-[12px] text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
            data-testid="filter-clear-all"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => onFocusModeChange(!focusMode)}
        aria-pressed={focusMode}
        data-testid="focus-mode-toggle"
        className={cn(
          "ml-auto inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-full px-[11px] text-[12.5px] transition-colors motion-reduce:transition-none",
          focusMode
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-band"
        )}
      >
        <Focus className="h-[13px] w-[13px]" />
        Focus
      </button>
    </div>
  );
}
