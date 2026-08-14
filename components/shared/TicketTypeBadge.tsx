"use client";

import { Badge } from "@/components/ui/badge";
import { Bug } from "lucide-react";

interface TicketTypeBadgeProps {
  /** Ticket type — renders nothing unless it is "bug". */
  type: string;
  /** Badge classes. Call sites keep their original class strings. */
  className?: string;
  /** Bug icon classes. Call sites keep their original class strings. */
  iconClassName?: string;
}

/** Red "Bug" badge shown on bug-type tickets (kanban card + epic detail). */
export function TicketTypeBadge({
  type,
  className = "text-xs bg-red-500/10 text-red-400",
  iconClassName = "h-3 w-3 mr-0.5",
}: TicketTypeBadgeProps) {
  if (type !== "bug") return null;
  return (
    <Badge className={className}>
      <Bug className={iconClassName} />
      Bug
    </Badge>
  );
}
