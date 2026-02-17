"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  KANBAN_COLUMNS,
  type KanbanStatus,
  type KanbanEpic,
  type BoardState,
  type ReorderItem,
} from "@/lib/types/kanban";

export interface UseKanbanOptions {
  onMoveError?: (error: string) => void;
}

export function useKanban(projectId: string, options?: UseKanbanOptions) {
  const [board, setBoard] = useState<BoardState>({
    columns: {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    },
  });
  const [loading, setLoading] = useState(true);
  const onMoveErrorRef = useRef(options?.onMoveError);
  onMoveErrorRef.current = options?.onMoveError;

  const loadEpics = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/epics`);
      const data = await res.json();
      const epics: KanbanEpic[] = data.data || [];

      const columns: BoardState["columns"] = {
        backlog: [],
        todo: [],
        in_progress: [],
        review: [],
        done: [],
      };

      for (const epic of epics) {
        const status = (epic.status as KanbanStatus) || "backlog";
        if (columns[status]) {
          columns[status].push(epic);
        } else {
          columns.backlog.push(epic);
        }
      }

      // Sort each column by position
      for (const col of KANBAN_COLUMNS) {
        columns[col].sort((a, b) => a.position - b.position);
      }

      setBoard({ columns });
    } catch {
      // ignore
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadEpics();
  }, [loadEpics]);

  const moveEpic = useCallback(
    async (
      epicId: string,
      fromColumn: KanbanStatus,
      toColumn: KanbanStatus,
      newIndex: number
    ) => {
      // Optimistic update
      setBoard((prev) => {
        const next = { columns: { ...prev.columns } };
        for (const col of KANBAN_COLUMNS) {
          next.columns[col] = [...prev.columns[col]];
        }

        // Remove from source
        const epicIndex = next.columns[fromColumn].findIndex(
          (e) => e.id === epicId
        );
        if (epicIndex === -1) return prev;
        const [epic] = next.columns[fromColumn].splice(epicIndex, 1);

        // Insert into destination
        epic.status = toColumn;
        next.columns[toColumn].splice(newIndex, 0, epic);

        return next;
      });

      // Build reorder items for all affected columns
      setTimeout(async () => {
        setBoard((current) => {
          const reorderItems: ReorderItem[] = [];
          for (const col of KANBAN_COLUMNS) {
            if (col === fromColumn || col === toColumn) {
              current.columns[col].forEach((epic, idx) => {
                reorderItems.push({
                  id: epic.id,
                  status: col,
                  position: idx,
                });
              });
            }
          }

          // Fire API call
          fetch(`/api/projects/${projectId}/epics/reorder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: reorderItems }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              const errorMsg = data.error || "Failed to move epic";
              onMoveErrorRef.current?.(errorMsg);
              // Rollback
              loadEpics();
            }
          }).catch(() => {
            // Rollback on network failure
            loadEpics();
          });

          return current;
        });
      }, 0);
    },
    [projectId, loadEpics]
  );

  return { board, loading, moveEpic, refresh: loadEpics };
}
