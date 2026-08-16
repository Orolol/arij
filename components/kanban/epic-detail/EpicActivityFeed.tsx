"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/documents/MentionTextarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import {
  Send,
  User,
  Bot,
  Cog,
  Loader2,
  Hammer,
  ArrowRight,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { TicketComment } from "@/hooks/useTicketComments";
import {
  useEpicActivity,
  type EpicActivityEntry,
} from "@/hooks/useEpicActivity";
import { formatTime, timeAgo } from "@/lib/utils/format-date";
import { COLUMN_LABELS } from "@/lib/types/kanban";

/* ------------------------------------------------------------------ */
/* Feed construction (pure, exported for tests)                        */
/* ------------------------------------------------------------------ */

/** Consecutive system transitions closer together than this collapse into one group. */
export const SYSTEM_GROUP_WINDOW_MS = 60_000;

export type FeedItem =
  | { kind: "comment"; ts: string; comment: TicketComment }
  | { kind: "transition"; ts: string; entry: EpicActivityEntry }
  | { kind: "transition-group"; ts: string; entries: EpicActivityEntry[] };

/**
 * Merge comments and transition entries into one chronological (oldest-first)
 * feed. Runs of 2+ consecutive `system` transitions whose successive
 * timestamps are within `SYSTEM_GROUP_WINDOW_MS` collapse into a single
 * `transition-group` item (timestamped at the run's newest entry).
 */
export function buildActivityFeed(
  comments: TicketComment[],
  entries: EpicActivityEntry[]
): FeedItem[] {
  const raw: FeedItem[] = [
    ...comments.map((comment) => ({
      kind: "comment" as const,
      ts: comment.createdAt ?? "",
      comment,
    })),
    ...entries.map((entry) => ({
      kind: "transition" as const,
      ts: entry.createdAt ?? "",
      entry,
    })),
  ].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const feed: FeedItem[] = [];
  let run: EpicActivityEntry[] = [];

  const flushRun = () => {
    if (run.length >= 2) {
      feed.push({
        kind: "transition-group",
        ts: run[run.length - 1].createdAt ?? "",
        entries: run,
      });
    } else {
      for (const entry of run) {
        feed.push({ kind: "transition", ts: entry.createdAt ?? "", entry });
      }
    }
    run = [];
  };

  for (const item of raw) {
    if (item.kind === "transition" && item.entry.actor === "system") {
      const prev = run[run.length - 1];
      const gap =
        prev && prev.createdAt && item.entry.createdAt
          ? new Date(item.entry.createdAt).getTime() -
            new Date(prev.createdAt).getTime()
          : Number.POSITIVE_INFINITY;
      if (prev && gap > SYSTEM_GROUP_WINDOW_MS) flushRun();
      run.push(item.entry);
    } else {
      flushRun();
      feed.push(item);
    }
  }
  flushRun();

  return feed;
}

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

const ACTOR_STYLES: Record<
  EpicActivityEntry["actor"],
  { label: string; Icon: typeof User; className: string }
> = {
  user: { label: "You", Icon: User, className: "text-foreground" },
  agent: { label: "Agent", Icon: Bot, className: "text-blue-500" },
  system: { label: "System", Icon: Cog, className: "text-amber-500" },
};

function StatusChip({ status }: { status: string }) {
  const label =
    (COLUMN_LABELS as Record<string, string>)[status] ?? status;
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
      {label}
    </span>
  );
}

function TransitionRow({
  entry,
  projectId,
}: {
  entry: EpicActivityEntry;
  projectId: string;
}) {
  const actor = ACTOR_STYLES[entry.actor] ?? ACTOR_STYLES.system;
  const { Icon } = actor;
  return (
    <div
      data-testid="activity-transition"
      data-actor={entry.actor}
      className="flex flex-wrap items-center gap-1.5 px-1 py-0.5 text-xs"
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${actor.className}`} />
      <span className={`font-medium ${actor.className}`}>{actor.label}</span>
      <span className="text-muted-foreground">moved</span>
      <StatusChip status={entry.fromStatus} />
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <StatusChip status={entry.toStatus} />
      <span className="text-muted-foreground">{timeAgo(entry.createdAt)}</span>
      {entry.sessionId && (
        <Link
          data-testid="activity-session-link"
          href={`/projects/${projectId}/sessions/${entry.sessionId}`}
          className="text-primary underline-offset-2 hover:underline"
        >
          View session
        </Link>
      )}
      {entry.reason && (
        <span className="w-full pl-5 italic text-muted-foreground">
          {entry.reason}
        </span>
      )}
    </div>
  );
}

function TransitionGroupRow({
  entries,
  ts,
  projectId,
}: {
  entries: EpicActivityEntry[];
  ts: string;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        data-testid="activity-transition-group"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Cog className="h-3.5 w-3.5 text-amber-500" />
        <span>{entries.length} automatic transitions</span>
        <span>{timeAgo(ts)}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-border pl-2">
          {entries.map((entry) => (
            <TransitionRow key={entry.id} entry={entry} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentRow({ comment }: { comment: TicketComment }) {
  return (
    <div
      data-testid="activity-comment"
      className={`rounded-lg p-3 ${
        comment.author === "agent"
          ? "bg-muted/50 border border-border"
          : "bg-primary/5 border border-primary/10"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {comment.author === "agent" ? (
          <Bot className="h-3.5 w-3.5 text-blue-500" />
        ) : (
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium">
          {comment.author === "agent" ? "Agent" : "You"}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatTime(comment.createdAt)}
        </span>
      </div>
      <div className="text-sm">
        <MarkdownContent content={comment.content} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

interface EpicActivityFeedProps {
  projectId: string;
  epicId: string | null;
  comments: TicketComment[];
  commentsLoading: boolean;
  onAddComment: (content: string) => Promise<unknown>;
  /** One-click dispatch: immediately sends to dev without dialog */
  onSendToDev?: () => Promise<unknown>;
  /** Whether the send-to-dev action is disabled (agent running, etc.) */
  sendToDevDisabled?: boolean;
  /** Whether the send-to-dev action is currently dispatching */
  sendToDevLoading?: boolean;
}

/**
 * Unified activity feed for an epic: comments and kanban transitions
 * interleaved chronologically, plus the comment composer.
 *
 * Transitions come from `useEpicActivity` (polled at 5s while mounted; the
 * Activity tab unmounts this component when hidden, so polling stops with it).
 */
export function EpicActivityFeed({
  projectId,
  epicId,
  comments,
  commentsLoading,
  onAddComment,
  onSendToDev,
  sendToDevDisabled,
  sendToDevLoading,
}: EpicActivityFeedProps) {
  const { entries, loading: activityLoading } = useEpicActivity(
    projectId,
    epicId
  );

  const feed = useMemo(
    () => buildActivityFeed(comments, entries),
    [comments, entries]
  );

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feed.length]);

  async function handleSubmit() {
    if (!input.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await onAddComment(input.trim());
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add comment");
    } finally {
      setSending(false);
    }
  }

  const loading = commentsLoading || activityLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border">
        <h3 className="text-sm font-medium">
          Activity ({comments.length + entries.length})
        </h3>
      </div>

      {/* Feed */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="p-4 space-y-3">
          {loading && feed.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : feed.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No activity yet. Start the conversation.
            </p>
          ) : (
            feed.map((item) =>
              item.kind === "comment" ? (
                <CommentRow key={item.comment.id} comment={item.comment} />
              ) : item.kind === "transition" ? (
                <TransitionRow
                  key={item.entry.id}
                  entry={item.entry}
                  projectId={projectId}
                />
              ) : (
                <TransitionGroupRow
                  key={item.entries[0].id}
                  entries={item.entries}
                  ts={item.ts}
                  projectId={projectId}
                />
              )
            )
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border">
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}
        <div className="flex gap-2">
          <MentionTextarea
            projectId={projectId}
            value={input}
            onValueChange={setInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Add a comment..."
            rows={3}
            className="min-h-24 resize-none"
          />
          <div className="flex flex-col gap-1 shrink-0 self-end">
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={!input.trim() || sending}
            >
              {sending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
            {onSendToDev && (
              <Button
                size="icon"
                variant="outline"
                onClick={onSendToDev}
                disabled={sendToDevDisabled || sendToDevLoading}
                title="Send to dev"
                data-testid="send-to-dev-button"
              >
                {sendToDevLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Hammer className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
