"use client";

import { KANBAN_COLUMNS, COLUMN_LABELS, type KanbanStatus } from "@/lib/types/kanban";
import { cn } from "@/lib/utils";

/** Loading board: the real column grammar with pulsing card ghosts. */
export function BoardSkeleton() {
  return (
    <div className="flex h-full gap-[16px] p-[22px]">
      {KANBAN_COLUMNS.map((status) => (
        <div
          key={status}
          className="flex min-w-[196px] max-w-[280px] flex-1 flex-col gap-[12px]"
        >
          <div
            className={cn(
              "flex items-baseline justify-between border-b pb-[9px]",
              status === "in_progress" ? "border-agent-border" : "border-border"
            )}
          >
            <span
              className={cn(
                "text-[11.5px] uppercase tracking-[.09em]",
                status === "in_progress" ? "text-agent" : "text-muted-foreground"
              )}
            >
              {COLUMN_LABELS[status as KanbanStatus]}
            </span>
            <span className="font-mono text-[11.5px] text-meta">&nbsp;</span>
          </div>
          <div className="flex flex-col gap-[12px]">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-[76px] animate-pulse rounded-[11px] border border-border bg-card motion-reduce:animate-none"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
