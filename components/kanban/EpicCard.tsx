"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Card } from "@/components/ui/card";
import { PriorityBadge } from "@/components/shared/PriorityBadge";
import { TicketTypeBadge } from "@/components/shared/TicketTypeBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type KanbanEpic,
  type KanbanAgentActionType,
  type KanbanEpicAgentActivity,
} from "@/lib/types/kanban";
import { formatElapsed } from "@/lib/utils/format-elapsed";
import {
  GitPullRequest,
  Hammer,
  Search,
  GitMerge,
  Bot,
  AlertTriangle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { FailedSessionInfo } from "@/hooks/useAgentPolling";

function providerLabel(provider?: string): string {
  if (!provider) return "Agent";
  if (provider === "gemini-cli") return "Gemini";
  if (provider === "codex") return "Codex";
  return "Claude Code";
}

/**
 * Per-epic state and callbacks derived by the Board and handed to a single card.
 *
 * Grouping these keeps the Board -> Column -> EpicCard chain from growing a new
 * prop on three interfaces every time a card feature ships: Column only forwards
 * the view object, and only this type plus the Board's builder change.
 */
export interface EpicCardView {
  selected?: boolean;
  autoIncluded?: boolean;
  isRunning?: boolean;
  /** Agent action currently running for this epic, if any */
  activity?: KanbanEpicAgentActivity;
  /** Whether the latest comment is AI-origin and still unseen */
  unreadAi?: boolean;
  /** Info about the most recent failed agent session for this epic */
  failedSession?: FailedSessionInfo;
  onToggleSelect?: () => void;
  onLinkedAgentHoverChange?: (activityId: string | null) => void;
  /** Called when user clicks the retry button on a failed session indicator */
  onRetryBuild?: () => void;
}

interface EpicCardProps {
  epic: KanbanEpic;
  isOverlay?: boolean;
  onClick?: () => void;
  /** Flash highlight when ticket state changes */
  highlight?: boolean;
  /** Per-epic state and callbacks, built by the Board */
  view?: EpicCardView;
  /** Disable dnd-kit sortable wiring (set by the Board while filters are active) */
  dragDisabled?: boolean;
}

/**
 * A card with no description and no stories is a bare idea (e.g. from quick
 * capture): flag it as a draft to nudge refinement before dispatching agents.
 */
export function isDraftEpic(
  epic: Pick<KanbanEpic, "description" | "usCount">
): boolean {
  return (!epic.description || epic.description.trim() === "") && epic.usCount === 0;
}

const ACTIVITY_ICON_BY_TYPE: Record<
  KanbanAgentActionType,
  { Icon: LucideIcon; label: string }
> = {
  build: { Icon: Hammer, label: "Build" },
  review: { Icon: Search, label: "Review" },
  merge: { Icon: GitMerge, label: "Merge" },
};

const EMPTY_VIEW: EpicCardView = {};

export function EpicCard({
  epic,
  isOverlay,
  onClick,
  highlight = false,
  view = EMPTY_VIEW,
  dragDisabled = false,
}: EpicCardProps) {
  const {
    selected,
    autoIncluded,
    activity: activeAgentActivity,
    unreadAi: hasUnreadAiUpdate = false,
    failedSession,
    onToggleSelect,
    onLinkedAgentHoverChange,
    onRetryBuild,
  } = view;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: epic.id, disabled: dragDisabled });

  const isDraft = isDraftEpic(epic);

  // Flash highlight animation state
  const [isHighlighted, setIsHighlighted] = useState(false);
  const prevHighlight = useRef(highlight);
  useEffect(() => {
    if (highlight && !prevHighlight.current) {
      setIsHighlighted(true);
      const timer = setTimeout(() => setIsHighlighted(false), 1500);
      return () => clearTimeout(timer);
    }
    prevHighlight.current = highlight;
  }, [highlight]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    rotate: isOverlay ? "2deg" : undefined,
  };

  const activityConfig = activeAgentActivity
    ? ACTIVITY_ICON_BY_TYPE[activeAgentActivity.actionType]
    : null;
  const linkedActivityId = activeAgentActivity?.sessionId ?? null;

  // Elapsed time ticker for active agent
  const [elapsedText, setElapsedText] = useState("");
  useEffect(() => {
    if (!activeAgentActivity?.startedAt) {
      setElapsedText("");
      return;
    }
    const update = () => setElapsedText(formatElapsed(activeAgentActivity.startedAt!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeAgentActivity?.startedAt]);

  function handleCardClick(event: MouseEvent) {
    const additiveSelection = event.metaKey || event.ctrlKey || event.shiftKey;

    if (additiveSelection && onToggleSelect) {
      event.preventDefault();
      onToggleSelect();
      return;
    }

    onClick?.();
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleCardClick}
      onMouseEnter={() => {
        if (!linkedActivityId) return;
        onLinkedAgentHoverChange?.(linkedActivityId);
      }}
      onMouseLeave={() => onLinkedAgentHoverChange?.(null)}
      onFocusCapture={() => {
        if (!linkedActivityId) return;
        onLinkedAgentHoverChange?.(linkedActivityId);
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        onLinkedAgentHoverChange?.(null);
      }}
      className={`p-2 gap-0 rounded-md shadow-none cursor-pointer hover:bg-accent/50 transition-all duration-300 motion-reduce:transition-none ${
        isOverlay ? "shadow-lg" : ""
      } ${isDragging ? "shadow-md" : ""} ${
        selected ? "ring-2 ring-primary" : autoIncluded ? "ring-2 ring-blue-400/50" : ""
      } ${epic.type === "bug" ? "border-l-2 border-l-red-500" : ""} ${
        isHighlighted ? "ring-2 ring-primary/70 bg-primary/5 motion-reduce:ring-0 motion-reduce:bg-transparent" : ""
      } ${isDraft ? "border-dashed" : ""}`}
    >
      <div className="mb-1">
        <div className="flex items-start gap-2">
          {activityConfig && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="relative shrink-0 mt-0.5 inline-flex items-center justify-center rounded-sm bg-yellow-500/10 text-yellow-600 p-0.5"
                    aria-label={`${activityConfig.label} active: ${activeAgentActivity!.agentName}`}
                    data-testid={`epic-activity-${epic.id}`}
                  >
                    <span className="absolute inset-0 rounded-sm bg-yellow-500/20 animate-pulse motion-reduce:animate-none" />
                    <activityConfig.Icon className="relative h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{activityConfig.label}: {activeAgentActivity!.agentName}</span>
                    <span className="text-muted-foreground">
                      {providerLabel(activeAgentActivity!.provider)}
                      {elapsedText && ` \u00B7 ${elapsedText}`}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <div className="flex-1 min-w-0">
            <span className="text-xs text-muted-foreground font-mono">{epic.readableId || epic.id}</span>
            <h4 className="text-sm font-medium leading-tight line-clamp-2">{epic.title}</h4>
          </div>
        </div>
        {epic.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{epic.description}</p>
        )}
        <div className="flex items-center gap-1 flex-wrap mt-1">
          {isDraft && (
            <span
              className="inline-flex items-center rounded-sm border border-dashed border-muted-foreground/40 px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
              title="Draft — add a description or stories before dispatching"
              data-testid={`epic-draft-${epic.id}`}
            >
              Draft
            </span>
          )}
          {hasUnreadAiUpdate && (
            <span
              className="inline-flex items-center justify-center rounded-sm bg-sky-500/15 text-sky-600 p-0.5"
              aria-label="Unread AI update"
              title="Unread AI update"
              data-testid={`epic-unread-ai-${epic.id}`}
            >
              <Bot className="h-3.5 w-3.5" />
            </span>
          )}
          {failedSession && !activeAgentActivity && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-0.5 rounded-sm bg-red-500/15 text-red-500 px-1 py-0.5"
                    aria-label="Agent session failed"
                    data-testid={`epic-error-${epic.id}`}
                  >
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-xs">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-red-400">Agent failed</span>
                    <span className="text-muted-foreground break-words">{failedSession.error}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {failedSession && !activeAgentActivity && onRetryBuild && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetryBuild();
              }}
              className="inline-flex items-center gap-0.5 rounded-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 px-1.5 py-0.5 text-xs transition-colors"
              aria-label="Retry failed agent session"
              data-testid={`epic-retry-${epic.id}`}
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
          )}
          <PriorityBadge priority={epic.priority} />
          <TicketTypeBadge type={epic.type} />
        </div>
      </div>
      <div className="flex items-center justify-between mt-1">
        {epic.type !== "bug" && (
          <span className="text-xs text-muted-foreground">
            {epic.usDone}/{epic.usCount} US
          </span>
        )}
        {epic.prNumber && epic.prUrl && (
          <a
            href={epic.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitPullRequest className="h-3 w-3" />
            <span>#{epic.prNumber}</span>
          </a>
        )}
      </div>
    </Card>
  );
}
