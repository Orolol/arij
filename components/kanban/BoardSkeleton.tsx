"use client";

import { KANBAN_COLUMNS, COLUMN_LABELS, type KanbanStatus } from "@/lib/types/kanban";

export function BoardSkeleton() {
  return (
    <div className="flex gap-4 h-full p-4">
      {KANBAN_COLUMNS.map((status) => (
        <div
          key={status}
          className="flex flex-col w-72 shrink-0 rounded-lg bg-muted/30"
        >
          <div className="px-3 py-2">
            <h3 className="font-medium text-sm">
              {COLUMN_LABELS[status as KanbanStatus]}
            </h3>
          </div>
          <div className="px-2 pb-2 space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-20 rounded-md bg-muted/50 animate-pulse"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
