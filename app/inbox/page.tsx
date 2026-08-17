"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Inbox, MessageCircleQuestion, Send, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useInbox, type InboxItem } from "@/hooks/useInbox";
import { timeAgo } from "@/lib/utils/format-date";
import {
  isBuildableStatus,
  COLUMN_LABELS,
  type KanbanStatus,
} from "@/lib/types/kanban";

interface ProjectGroup {
  projectId: string;
  projectName: string;
  items: InboxItem[];
}

/** Group rows by project, preserving the server order (awaiting-reply first). */
function groupByProject(items: InboxItem[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const byProject = new Map<string, ProjectGroup>();
  for (const item of items) {
    let group = byProject.get(item.projectId);
    if (!group) {
      group = {
        projectId: item.projectId,
        projectName: item.projectName,
        items: [],
      };
      byProject.set(item.projectId, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function statusLabel(status: string | null): string {
  if (!status) return "";
  return COLUMN_LABELS[status as KanbanStatus] ?? status;
}

function InboxRow({
  item,
  onReply,
  onMarkRead,
}: {
  item: InboxItem;
  onReply: (
    item: Pick<InboxItem, "projectId" | "epicId">,
    content: string
  ) => Promise<void>;
  onMarkRead: (epicId: string) => Promise<void>;
}) {
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState<"reply" | "dispatch" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSendToDev = isBuildableStatus(item.status);

  async function handleReply() {
    const content = replyText.trim();
    if (!content || busy) return;
    setBusy("reply");
    setError(null);
    try {
      await onReply(item, content);
      setReplyText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post reply");
    } finally {
      setBusy(null);
    }
  }

  // "Send to Dev" shortcut: a plain POST to the existing per-epic build
  // route (which already handles the comment, status sync, scheduling and
  // 409 concurrency) — no AgentActionsBar machinery needed. Any typed reply
  // rides along as the dispatch comment.
  async function handleSendToDev() {
    if (busy) return;
    setBusy("dispatch");
    setError(null);
    try {
      const comment = replyText.trim();
      const res = await fetch(
        `/api/projects/${item.projectId}/epics/${item.epicId}/build`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(comment ? { comment } : {}),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        throw new Error(body.error || "Failed to dispatch build agent");
      }
      setReplyText("");
      await onMarkRead(item.epicId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to dispatch build agent");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded-lg border border-border bg-card px-4 py-3 space-y-2"
      data-testid={`inbox-item-${item.epicId}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {item.awaitingReply && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-priority-yellow/10 text-priority-yellow px-2 py-0.5 text-[11px] font-medium shrink-0"
            data-testid={`inbox-awaiting-badge-${item.epicId}`}
          >
            <MessageCircleQuestion className="h-3 w-3" />
            Awaiting reply
          </span>
        )}
        {item.readableId && (
          <span className="text-xs font-mono text-muted-foreground shrink-0">
            {item.readableId}
          </span>
        )}
        <Link
          href={`/projects/${item.projectId}?ticket=${item.epicId}`}
          className="text-sm font-medium truncate hover:underline"
          data-testid={`inbox-item-link-${item.epicId}`}
        >
          {item.title}
        </Link>
        <span className="ml-auto text-xs text-muted-foreground shrink-0">
          {statusLabel(item.status)}
        </span>
      </div>

      {item.latestCommentExcerpt && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {item.latestCommentExcerpt}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {item.latestCommentAuthor ? `${item.latestCommentAuthor} · ` : ""}
        {timeAgo(item.latestCommentCreatedAt)}
      </p>

      <div className="flex items-end gap-2">
        <Textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Reply to the agent…"
          rows={1}
          className="min-h-9 text-sm flex-1 resize-none"
          data-testid={`inbox-reply-input-${item.epicId}`}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleReply}
          disabled={!replyText.trim() || busy !== null}
          data-testid={`inbox-reply-send-${item.epicId}`}
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          {busy === "reply" ? "Replying…" : "Reply"}
        </Button>
        {canSendToDev && (
          <Button
            size="sm"
            onClick={handleSendToDev}
            disabled={busy !== null}
            data-testid={`inbox-send-to-dev-${item.epicId}`}
          >
            <Hammer className="h-3.5 w-3.5 mr-1" />
            {busy === "dispatch" ? "Dispatching…" : "Send to Dev"}
          </Button>
        )}
      </div>
      {error && (
        <p
          className="text-xs text-destructive"
          data-testid={`inbox-item-error-${item.epicId}`}
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default function InboxPage() {
  const { items, loading, markRead, reply } = useInbox();

  const groups = useMemo(() => groupByProject(items), [items]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6" data-testid="inbox-page">
      <div className="flex items-center gap-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Agents waiting on you, across all projects.
          </p>
        </div>
        {items.length > 0 && (
          <span
            className="ml-auto text-sm text-muted-foreground"
            data-testid="inbox-count"
          >
            {items.length} waiting
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div
          className="py-12 text-center text-sm text-muted-foreground"
          data-testid="inbox-empty"
        >
          Inbox zero — no agents are waiting on you.
        </div>
      ) : (
        groups.map((group) => (
          <section
            key={group.projectId}
            className="space-y-2"
            data-testid={`inbox-project-group-${group.projectId}`}
          >
            <h2 className="text-sm font-semibold text-muted-foreground">
              <Link
                href={`/projects/${group.projectId}`}
                className="hover:underline"
              >
                {group.projectName}
              </Link>{" "}
              <span className="font-normal">({group.items.length})</span>
            </h2>
            {group.items.map((item) => (
              <InboxRow
                key={item.epicId}
                item={item}
                onReply={reply}
                onMarkRead={markRead}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
