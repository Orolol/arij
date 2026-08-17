"use client";

import { Card } from "@/components/ui/card";
import {
  ArrowRightLeft,
  ClipboardList,
  HelpCircle,
  MessageSquare,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Client-side mirror of lib/agent-sessions/arij-actions.ts#ArijAction
 * (the session detail API returns these as plain JSON).
 */
export interface ArijActionItem {
  kind: "status_change" | "comment" | "question" | "findings" | "tool_call";
  summary: string;
  detail?: string;
  at: string | null;
}

const KIND_ICONS: Record<ArijActionItem["kind"], LucideIcon> = {
  status_change: ArrowRightLeft,
  comment: MessageSquare,
  question: HelpCircle,
  findings: ClipboardList,
  tool_call: Wrench,
};

const KIND_COLORS: Record<ArijActionItem["kind"], string> = {
  status_change: "text-blue-400",
  comment: "text-muted-foreground",
  question: "text-amber-400",
  findings: "text-purple-400",
  tool_call: "text-muted-foreground/70",
};

function formatActionTime(at: string | null): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString();
}

/**
 * Compact "Arij actions" list on the session detail page: the structured
 * effects the agent had on the board (status changes, comments, questions,
 * review findings, MCP tool calls). Renders nothing when there are none —
 * sessions without MCP injection stay visually unchanged.
 */
export function ArijActionsList({ actions }: { actions?: ArijActionItem[] | null }) {
  if (!actions || actions.length === 0) return null;

  return (
    <Card className="p-4 mb-6" data-testid="arij-actions">
      <h3 className="text-sm font-medium mb-3">Arij actions</h3>
      <ul className="space-y-2">
        {actions.map((action, idx) => {
          const Icon = KIND_ICONS[action.kind] ?? Wrench;
          const color = KIND_COLORS[action.kind] ?? "text-muted-foreground";
          const time = formatActionTime(action.at);
          return (
            <li
              key={idx}
              className="flex items-start gap-2 text-sm"
              data-testid={`arij-action-${action.kind}`}
            >
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <span>{action.summary}</span>
                {action.detail && (
                  <p className="text-xs text-muted-foreground truncate">
                    {action.detail}
                  </p>
                )}
              </div>
              {time && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {time}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
