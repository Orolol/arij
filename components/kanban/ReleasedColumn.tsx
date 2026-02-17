"use client";

import { useState } from "react";
import { Package, ChevronDown, ChevronRight, Bug, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { COLUMN_LABELS, type KanbanEpic, type ReleaseGroup } from "@/lib/types/kanban";

interface ReleasedColumnProps {
  releaseGroups: ReleaseGroup[];
  onEpicClick: (epicId: string) => void;
}

function ReleaseGroupCard({
  group,
  onEpicClick,
}: {
  group: ReleaseGroup;
  onEpicClick: (epicId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg bg-muted/50 overflow-hidden">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 p-2.5 text-sm hover:bg-muted/70 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Package className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium truncate">v{group.version}</span>
        {group.title && (
          <span className="text-muted-foreground truncate text-xs">
            — {group.title}
          </span>
        )}
        <Badge variant="secondary" className="ml-auto text-xs shrink-0">
          {group.epics.length}
        </Badge>
      </button>

      {expanded && group.epics.length > 0 && (
        <div className="px-2 pb-2 space-y-1">
          {group.epics.map((epic) => (
            <button
              key={epic.id}
              onClick={() => onEpicClick(epic.id)}
              className="w-full flex items-center gap-2 p-2 rounded text-sm hover:bg-accent/50 transition-colors text-left"
            >
              {epic.type === "bug" ? (
                <Bug className="h-3 w-3 text-red-400 shrink-0" />
              ) : (
                <Sparkles className="h-3 w-3 text-blue-400 shrink-0" />
              )}
              {epic.readableId && (
                <span className="text-xs text-muted-foreground font-mono shrink-0">
                  {epic.readableId}
                </span>
              )}
              <span className="flex-1 truncate">{epic.title}</span>
              {epic.usCount > 0 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {epic.usDone}/{epic.usCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReleasedColumn({ releaseGroups, onEpicClick }: ReleasedColumnProps) {
  const totalEpics = releaseGroups.reduce((sum, g) => sum + g.epics.length, 0);

  return (
    <div className="flex flex-col w-72 shrink-0 rounded-lg bg-muted/30">
      <div className="px-3 py-2 flex items-center justify-between">
        <h3 className="font-medium text-sm">{COLUMN_LABELS.released}</h3>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {totalEpics}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {releaseGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No releases yet
          </p>
        ) : (
          <div className="space-y-2">
            {releaseGroups.map((group) => (
              <ReleaseGroupCard
                key={group.id}
                group={group}
                onEpicClick={onEpicClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
