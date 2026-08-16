"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Column } from "./Column";
import { ReleasedColumn } from "./ReleasedColumn";
import { EpicCard, type EpicCardView } from "./EpicCard";
import {
  FilterBar,
  EMPTY_FILTERS,
  countActiveFilters,
  epicMatchesFilters,
  parseStoredFilters,
  type KanbanFilters,
} from "./FilterBar";
import {
  KANBAN_COLUMNS,
  DRAGGABLE_COLUMNS,
  COLUMN_LABELS,
  type KanbanStatus,
  type KanbanEpic,
  type KanbanEpicAgentActivity,
} from "@/lib/types/kanban";
import { useKanban } from "@/hooks/useKanban";
import { BoardSkeleton } from "./BoardSkeleton";
import type { FailedSessionInfo } from "@/hooks/useAgentPolling";

interface BoardProps {
  projectId: string;
  onEpicClick: (epicId: string) => void;
  selectedEpics?: Set<string>;
  autoIncludedEpics?: Set<string>;
  onToggleSelect?: (epicId: string) => void;
  refreshTrigger?: number;
  runningEpicIds?: Set<string>;
  activeAgentActivities?: Record<string, KanbanEpicAgentActivity>;
  onLinkedAgentHoverChange?: (activityId: string | null) => void;
  onMoveError?: (error: string) => void;
  failedSessions?: Record<string, FailedSessionInfo>;
  onRetryBuild?: (epicId: string) => void;
}

function isAiCommentAuthor(author: string | null | undefined) {
  if (!author) return false;
  return author.toLowerCase() !== "user";
}

/** Focus-mode placeholder: a column reduced to its header and card count. */
function CollapsedColumn({
  label,
  count,
  testId,
}: {
  label: string;
  count: number;
  testId: string;
}) {
  return (
    <div
      className="flex flex-col w-24 shrink-0 rounded-lg bg-muted/30"
      data-testid={testId}
    >
      <div className="px-3 py-2 flex items-center justify-between gap-1">
        <h3 className="font-medium text-sm truncate">{label}</h3>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {count}
        </span>
      </div>
    </div>
  );
}

export function Board({
  projectId,
  onEpicClick,
  selectedEpics,
  autoIncludedEpics,
  onToggleSelect,
  refreshTrigger,
  runningEpicIds,
  activeAgentActivities,
  onLinkedAgentHoverChange,
  onMoveError,
  failedSessions,
  onRetryBuild,
}: BoardProps) {
  const { board, loading, moveEpic, refresh } = useKanban(projectId, { onMoveError });
  const [seenAiCommentIdsByEpic, setSeenAiCommentIdsByEpic] = useState<
    Record<string, string>
  >({});
  const seenStorageKey = useMemo(
    () => `arij:kanban:seen-ai-comments:${projectId}`,
    [projectId]
  );

  // Client-side filters + focus mode, persisted per project in localStorage
  // (house pattern: the arij.unified-chat-panel.* keys).
  const [filters, setFilters] = useState<KanbanFilters>(EMPTY_FILTERS);
  const [focusMode, setFocusMode] = useState(false);
  const filtersStorageKey = useMemo(
    () => `arij.kanban-board.filters.${projectId}`,
    [projectId]
  );
  const focusStorageKey = useMemo(
    () => `arij.kanban-board.focus.${projectId}`,
    [projectId]
  );

  // Read persisted filters/focus on mount (before the write effects below run
  // with fresh state, so the stored value is captured first).
  useEffect(() => {
    try {
      setFilters(parseStoredFilters(window.localStorage.getItem(filtersStorageKey)));
      setFocusMode(window.localStorage.getItem(focusStorageKey) === "true");
    } catch {
      setFilters(EMPTY_FILTERS);
      setFocusMode(false);
    }
  }, [filtersStorageKey, focusStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(filtersStorageKey, JSON.stringify(filters));
    } catch {
      // ignore storage write failures
    }
  }, [filters, filtersStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(focusStorageKey, focusMode ? "true" : "false");
    } catch {
      // ignore storage write failures
    }
  }, [focusMode, focusStorageKey]);

  useEffect(() => {
    if (refreshTrigger) refresh();
  }, [refreshTrigger, refresh]);
  const [activeEpic, setActiveEpic] = useState<KanbanEpic | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(seenStorageKey);
      if (!raw) {
        setSeenAiCommentIdsByEpic({});
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setSeenAiCommentIdsByEpic(parsed as Record<string, string>);
      } else {
        setSeenAiCommentIdsByEpic({});
      }
    } catch {
      setSeenAiCommentIdsByEpic({});
    }
  }, [seenStorageKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const findEpicById = useCallback(
    (id: string): { epic: KanbanEpic; column: KanbanStatus } | null => {
      for (const col of KANBAN_COLUMNS) {
        const epic = board.columns[col].find((e) => e.id === id);
        if (epic) return { epic, column: col };
      }
      return null;
    },
    [board]
  );

  const unreadAiByEpicId = useMemo(() => {
    const unread: Record<string, boolean> = {};

    for (const status of KANBAN_COLUMNS) {
      for (const epic of board.columns[status]) {
        const latestCommentId = epic.latestCommentId;
        const latestCommentAuthor = epic.latestCommentAuthor;

        if (!latestCommentId || !isAiCommentAuthor(latestCommentAuthor)) {
          unread[epic.id] = false;
          continue;
        }

        unread[epic.id] = seenAiCommentIdsByEpic[epic.id] !== latestCommentId;
      }
    }

    return unread;
  }, [board, seenAiCommentIdsByEpic]);

  const markEpicAiCommentSeen = useCallback(
    (epicId: string) => {
      const found = findEpicById(epicId);
      if (!found) return;

      const latestCommentId = found.epic.latestCommentId;
      const latestCommentAuthor = found.epic.latestCommentAuthor;
      if (!latestCommentId || !isAiCommentAuthor(latestCommentAuthor)) return;

      setSeenAiCommentIdsByEpic((prev) => {
        if (prev[epicId] === latestCommentId) return prev;
        const next = { ...prev, [epicId]: latestCommentId };
        try {
          sessionStorage.setItem(seenStorageKey, JSON.stringify(next));
        } catch {
          // ignore storage write failures
        }
        return next;
      });
    },
    [findEpicById, seenStorageKey]
  );

  const handleEpicClick = useCallback(
    (epicId: string) => {
      markEpicAiCommentSeen(epicId);
      onEpicClick(epicId);
    },
    [markEpicAiCommentSeen, onEpicClick]
  );

  // Per-epic view models: the Board owns the assembly so Column and EpicCard
  // stay out of the business of forwarding one prop per card feature.
  const epicViews = useMemo(() => {
    const views: Record<string, EpicCardView> = {};

    for (const status of DRAGGABLE_COLUMNS) {
      for (const epic of board.columns[status]) {
        const failedSession = failedSessions?.[epic.id];

        views[epic.id] = {
          selected:
            selectedEpics?.has(epic.id) || autoIncludedEpics?.has(epic.id),
          autoIncluded: autoIncludedEpics?.has(epic.id),
          isRunning: runningEpicIds?.has(epic.id) || false,
          activity: activeAgentActivities?.[epic.id],
          unreadAi: unreadAiByEpicId[epic.id] || false,
          failedSession,
          onToggleSelect: onToggleSelect
            ? () => onToggleSelect(epic.id)
            : undefined,
          onLinkedAgentHoverChange,
          onRetryBuild:
            onRetryBuild && failedSession
              ? () => onRetryBuild(epic.id)
              : undefined,
        };
      }
    }

    return views;
  }, [
    board,
    selectedEpics,
    autoIncludedEpics,
    runningEpicIds,
    activeAgentActivities,
    unreadAiByEpicId,
    failedSessions,
    onToggleSelect,
    onLinkedAgentHoverChange,
    onRetryBuild,
  ]);

  // Pure client-side filter layer over the board columns. While any filter is
  // active, drag-and-drop is disabled entirely (see the guards in the drag
  // handlers and the disabled flags threaded to Column/EpicCard): drop indices
  // against a filtered list would not match the underlying board order.
  const activeFilterCount = countActiveFilters(filters);
  const filtersActive = activeFilterCount > 0;

  const visibleColumns = useMemo(() => {
    if (!filtersActive) return board.columns;

    const next = { ...board.columns };
    for (const status of DRAGGABLE_COLUMNS) {
      next[status] = board.columns[status].filter((epic) =>
        epicMatchesFilters(epic, filters, {
          isRunning: runningEpicIds?.has(epic.id) || false,
          unreadAi: unreadAiByEpicId[epic.id] || false,
          hasFailedSession: !!failedSessions?.[epic.id],
        })
      );
    }
    return next;
  }, [
    board,
    filters,
    filtersActive,
    runningEpicIds,
    unreadAiByEpicId,
    failedSessions,
  ]);

  // The drag overlay is a preview: it deliberately shows only the live agent
  // signals, never selection rings or failed-session affordances.
  const overlayView = useMemo<EpicCardView | undefined>(() => {
    if (!activeEpic) return undefined;

    return {
      isRunning: runningEpicIds?.has(activeEpic.id) || false,
      activity: activeAgentActivities?.[activeEpic.id],
      unreadAi: unreadAiByEpicId[activeEpic.id],
      onLinkedAgentHoverChange,
    };
  }, [
    activeEpic,
    runningEpicIds,
    activeAgentActivities,
    unreadAiByEpicId,
    onLinkedAgentHoverChange,
  ]);

  if (loading) return <BoardSkeleton />;

  function handleDragStart(event: DragStartEvent) {
    // No drag while filtering: the visible order diverges from board order.
    if (filtersActive) return;
    const found = findEpicById(event.active.id as string);
    if (!found) return;
    // Block dragging from the released column
    if (found.column === "released") return;
    setActiveEpic(found.epic);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveEpic(null);

    // Dropping into a filtered view must be impossible, not just visually odd.
    if (filtersActive) return;

    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeResult = findEpicById(activeId);
    if (!activeResult) return;
    // Block drops from/to released column
    if (activeResult.column === "released") return;

    // Determine target column
    let targetColumn: KanbanStatus;
    let targetIndex: number;

    // Check if dropping on a column directly
    if (KANBAN_COLUMNS.includes(overId as KanbanStatus)) {
      targetColumn = overId as KanbanStatus;
      if (targetColumn === "released") return;
      targetIndex = board.columns[targetColumn].length;
    } else {
      // Dropping on another epic
      const overResult = findEpicById(overId);
      if (!overResult) return;
      if (overResult.column === "released") return;
      targetColumn = overResult.column;
      targetIndex = board.columns[targetColumn].findIndex((e) => e.id === overId);
    }

    if (activeResult.column === targetColumn) {
      // Same column reorder
      const currentIndex = board.columns[targetColumn].findIndex(
        (e) => e.id === activeId
      );
      if (currentIndex === targetIndex) return;
    }

    moveEpic(activeId, activeResult.column, targetColumn, targetIndex);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full">
        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          focusMode={focusMode}
          onFocusModeChange={setFocusMode}
        />
        <div className="flex gap-4 flex-1 min-h-0 p-4 pt-2 overflow-x-auto">
          {DRAGGABLE_COLUMNS.map((status) =>
            focusMode && status === "done" ? (
              <CollapsedColumn
                key={status}
                label={COLUMN_LABELS[status]}
                count={visibleColumns[status].length}
                testId="collapsed-column-done"
              />
            ) : (
              <Column
                key={status}
                status={status}
                epics={visibleColumns[status]}
                onEpicClick={handleEpicClick}
                epicViews={epicViews}
                dragDisabled={filtersActive}
              />
            )
          )}
          {focusMode ? (
            <CollapsedColumn
              label={COLUMN_LABELS.released}
              count={board.columns.released.length}
              testId="collapsed-column-released"
            />
          ) : (
            <ReleasedColumn
              releaseGroups={board.releaseGroups || []}
              onEpicClick={handleEpicClick}
            />
          )}
        </div>
      </div>
      <DragOverlay>
        {activeEpic && (
          <div className="w-[272px]">
            <EpicCard epic={activeEpic} isOverlay view={overlayView} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
