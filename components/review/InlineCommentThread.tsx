"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Trash2, User, Bot } from "lucide-react";
import type { ReviewComment } from "@/hooks/useReviewComments";
import { formatDateTime } from "@/lib/i18n/format";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Stamp } from "@/components/piscine";
import { cn } from "@/lib/utils";

interface InlineCommentThreadProps {
  disabled?: boolean;
  comments: ReviewComment[];
  onUpdate: (id: string, updates: { body?: string; status?: string }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

export function InlineCommentThread({
  comments,
  onUpdate,
  onDelete,
  disabled,
}: InlineCommentThreadProps) {
  const locale = useLocale();
  const t = useTranslations("Review");
  return (
    <div className="space-y-1">
      {comments.map((comment) => (
        <div
          key={comment.id}
          className={cn(
            "rounded-[10px] p-2.5 text-xs border border-border/40 bg-card",
            comment.status === "resolved" && "opacity-60",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            {comment.author === "agent" ? (
              <Bot className="h-3 w-3 text-muted-foreground" />
            ) : (
              <User className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="font-medium">
              {comment.author === "agent" ? t("thread.agent") : t("thread.you")}
            </span>
            <span className="text-muted-foreground">
              {formatDateTime(comment.createdAt, { locale, style: "dayTime" })}
            </span>
            {comment.status === "resolved" && (
              <Stamp tone="land">
                {t("thread.resolved")}
              </Stamp>
            )}
            <div className="flex-1" />
            {comment.status === "open" && (
              <button
                type="button"
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-0 disabled:opacity-50"
                onClick={() => onUpdate(comment.id, { status: "resolved" })}
                title={t("thread.resolve")}
                aria-label={t("thread.resolve")}
                disabled={disabled}
              >
                <Check className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              className="h-5 w-5 flex items-center justify-center rounded text-destructive/80 hover:text-destructive cursor-pointer bg-transparent border-0 disabled:opacity-50"
              onClick={() => onDelete(comment.id)}
              title={t("thread.delete")}
              aria-label={t("thread.delete")}
              disabled={disabled}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="text-xs">
            <MarkdownContent content={comment.body} />
          </div>
        </div>
      ))}
    </div>
  );
}
