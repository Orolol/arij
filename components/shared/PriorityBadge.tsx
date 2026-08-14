"use client";

import { Badge } from "@/components/ui/badge";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/types/kanban";

interface PriorityBadgeProps {
  priority: number;
}

/** Colored priority badge ("Low" / "Medium" / "High" / "Urgent"). */
export function PriorityBadge({ priority }: PriorityBadgeProps) {
  return (
    <Badge
      className={`text-xs ${PRIORITY_COLORS[priority] || PRIORITY_COLORS[0]}`}
    >
      {PRIORITY_LABELS[priority] || "Low"}
    </Badge>
  );
}
