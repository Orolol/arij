"use client";

import { useState, useEffect, useCallback } from "react";
import {
  KANBAN_COLUMNS,
  type KanbanStatus,
  type KanbanEpic,
  type BoardState,
  type ReorderItem,
} from "@/lib/types/kanban";

export function useKanban(projectId: string) {
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
      const currentBoard = board; // use pre-optimistic state for fallback
      const items: ReorderItem[] = [];

      // We need to rebuild from the optimistic state - use a timeout to read updated state
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
          }).catch(() => {
            // Rollback on failure
            loadEpics();
          });

          return current;
        });
      }, 0);
    },
    [projectId, board, loadEpics]
  );

  return { board, loading, moveEpic, refresh: loadEpics };
}
