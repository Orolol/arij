"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { COLUMN_LABELS, type ReleaseGroup } from "@/lib/types/kanban";

interface ReleasedColumnProps {
  releaseGroups: ReleaseGroup[];
  onEpicClick: (epicId: string) => void;
}

/**
 * A shipped release is a digest line, not a card: one row per epic, title over
 * a mono id, grouped by version and collapsed by default. Nothing here is
 * draggable — the column exists to answer "did it land?", not to be worked.
 */
function ReleaseGroupRows({
  group,
  onEpicClick,
}: {
  group: ReleaseGroup;
  onEpicClick: (epicId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-[7px] border-b border-border py-[10px] text-left transition-colors hover:text-primary motion-reduce:transition-none"
      >
        {expanded ? (
          <ChevronDown className="h-[13px] w-[13px] shrink-0 text-meta" />
        ) : (
          <ChevronRight className="h-[13px] w-[13px] shrink-0 text-meta" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
          v{group.version}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-meta">
          {group.epics.length}
        </span>
      </button>

      {expanded &&
        group.epics.map((epic) => (
          <button
            key={epic.id}
            type="button"
            onClick={() => onEpicClick(epic.id)}
            className="flex w-full flex-col items-start gap-[3px] border-b border-border-soft py-[10px] text-left transition-colors hover:text-primary motion-reduce:transition-none"
          >
            <span className="line-clamp-2 text-[13px] leading-[1.35]">
              {epic.title}
            </span>
            <span className="font-mono text-[10.5px] text-meta">
              {epic.readableId || epic.id}
            </span>
          </button>
        ))}
    </div>
  );
}

export function ReleasedColumn({ releaseGroups, onEpicClick }: ReleasedColumnProps) {
  const totalEpics = releaseGroups.reduce((sum, g) => sum + g.epics.length, 0);

  return (
    <div className="flex w-[196px] shrink-0 flex-col gap-[12px]">
      <div className="flex items-baseline justify-between border-b border-border pb-[9px]">
        <span className="text-[11.5px] uppercase tracking-[.09em] text-muted-foreground">
          {COLUMN_LABELS.released}
        </span>
        <span className="font-mono text-[11.5px] text-meta">{totalEpics}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {releaseGroups.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No releases yet</p>
        ) : (
          releaseGroups.map((group) => (
            <ReleaseGroupRows
              key={group.id}
              group={group}
              onEpicClick={onEpicClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
