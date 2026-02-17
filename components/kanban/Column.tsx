"use client";

import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { EpicCard } from "./EpicCard";
import {
  COLUMN_LABELS,
  type KanbanStatus,
  type KanbanEpic,
  type KanbanEpicAgentActivity,
} from "@/lib/types/kanban";
import type { FailedSessionInfo } from "@/hooks/useAgentPolling";

interface ColumnProps {
  status: KanbanStatus;
  epics: KanbanEpic[];
  onEpicClick: (epicId: string) => void;
  selectedEpics?: Set<string>;
  autoIncludedEpics?: Set<string>;
  onToggleSelect?: (epicId: string) => void;
  runningEpicIds?: Set<string>;
  activeAgentActivities?: Record<string, KanbanEpicAgentActivity>;
  onLinkedAgentHoverChange?: (activityId: string | null) => void;
  unreadAiByEpicId?: Record<string, boolean>;
  failedSessions?: Record<string, FailedSessionInfo>;
  onRetryBuild?: (epicId: string) => void;
}

export function Column({
  status,
  epics,
  onEpicClick,
  selectedEpics,
  autoIncludedEpics,
  onToggleSelect,
  runningEpicIds,
  activeAgentActivities,
  onLinkedAgentHoverChange,
  unreadAiByEpicId,
  failedSessions,
  onRetryBuild,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  // Track newly arrived epics for highlight animation
  const prevEpicIdsRef = useRef<Set<string>>(new Set());
  const [highlightedEpicIds, setHighlightedEpicIds] = useState<Set<string>>(new Set());
  const [headerHighlight, setHeaderHighlight] = useState(false);

  useEffect(() => {
    const currentIds = new Set(epics.map((e) => e.id));
    const prevIds = prevEpicIdsRef.current;

    // Find newly arrived epics (in current but not in previous)
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIds.has(id)) {
        newIds.add(id);
      }
    }

    if (newIds.size > 0 && prevIds.size > 0) {
      // Only highlight if we had items before (skip initial load)
      setHighlightedEpicIds(newIds);
      setHeaderHighlight(true);

      const timer = setTimeout(() => {
        setHighlightedEpicIds(new Set());
        setHeaderHighlight(false);
      }, 1500);

      prevEpicIdsRef.current = currentIds;
      return () => clearTimeout(timer);
    }

    prevEpicIdsRef.current = currentIds;
  }, [epics]);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-72 shrink-0 rounded-lg bg-muted/30 transition-all duration-300 motion-reduce:transition-none ${
        isOver ? "ring-2 ring-primary/50" : ""
      }`}
    >
      <div className={`px-3 py-2 flex items-center justify-between transition-colors duration-300 motion-reduce:transition-none rounded-t-lg ${
        headerHighlight ? "bg-primary/10" : ""
      }`}>
        <h3 className="font-medium text-sm">{COLUMN_LABELS[status]}</h3>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {epics.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <SortableContext
          items={epics.map((e) => e.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 min-h-[50px]">
            {epics.map((epic) => (
              <div
                key={epic.id}
                className={highlightedEpicIds.has(epic.id)
                  ? "animate-in fade-in slide-in-from-left-4 zoom-in-95 duration-500 motion-reduce:animate-none"
                  : ""
                }
              >
                <EpicCard
                  epic={epic}
                  onClick={() => onEpicClick(epic.id)}
                  selected={selectedEpics?.has(epic.id) || autoIncludedEpics?.has(epic.id)}
                  autoIncluded={autoIncludedEpics?.has(epic.id)}
                  isRunning={runningEpicIds?.has(epic.id) || false}
                  activeAgentActivity={activeAgentActivities?.[epic.id]}
                  onLinkedAgentHoverChange={onLinkedAgentHoverChange}
                  hasUnreadAiUpdate={unreadAiByEpicId?.[epic.id] || false}
                  highlight={highlightedEpicIds.has(epic.id)}
                  onToggleSelect={
                    onToggleSelect
                      ? () => onToggleSelect(epic.id)
                      : undefined
                  }
                  failedSession={failedSessions?.[epic.id]}
                  onRetry={
                    onRetryBuild && failedSessions?.[epic.id]
                      ? () => onRetryBuild(epic.id)
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
