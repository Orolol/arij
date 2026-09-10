"use client";

import { useLocale, useTranslations } from "next-intl";
/**
 * One comment in the CONVERSATION band (frame 6a, lines 264-267).
 *
 * The frame draws only the agent bubble. The user variant is defined here:
 * the SAME geometry on the sunken `--field` paper instead of the agent's
 * crisp `--card` white. The difference is a surface, never a colour — the
 * design's first rule reserves colour for stratum and identity — and both
 * bubbles stay full-width: this is a work log, not a chat app, so the user's
 * messages are not right-aligned.
 *
 * LONG BUILD LOGS AND REVIEW DUMPS are what actually lands here, and agents
 * write them in markdown — headings, lists, `**bold**`, fenced blocks. The
 * body therefore goes through the shared renderer rather than being printed
 * under `whitespace-pre-wrap`, which showed the reader the syntax instead of
 * what it meant; that also gives a pipeline red→green report its structured
 * block here, which the ticket feed already did.
 *
 * Long comments collapse behind a word-boundary preview
 * (`lib/markdown/preview.ts` — the preview of structured text has to be
 * flattened and fence-free, or the renderer reads structure the truncation cut
 * in half), expandable in place.
 */

import { useState } from "react";

import { Mono, QuietLink } from "@/components/piscine";
import { cn } from "@/lib/utils";
import { isLongComment } from "@/lib/kanban/activity-feed";
import { markdownPreview } from "@/lib/markdown/preview";
import type { TicketComment } from "@/hooks/useTicketComments";
import { formatRelative } from "@/lib/i18n/format";
import { TicketCommentContent } from "@/components/verify/TicketCommentContent";

export interface CommentBubbleProps {
  comment: TicketComment;
}

export function CommentBubble({ comment }: CommentBubbleProps) {
  const t = useTranslations("Ticket");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const isUser = comment.author === "user";
  const long = isLongComment(comment.content);
  const body =
    long && !expanded ? markdownPreview(comment.content) : comment.content;

  return (
    <div
      data-testid="ticket-comment"
      data-author={comment.author}
      className={cn(
        "rounded-[12px] px-[13px] py-[10px]",
        isUser ? "bg-field" : "bg-card",
      )}
    >
      <Mono as="span" size={10} tone="muted" className="mb-1 block">
        {`${isUser ? t("comment.you") : t("comment.agent")} · ${formatRelative(comment.createdAt, { locale })}`}
      </Mono>
      <div className="text-[13px] leading-[1.5] text-foreground">
        <TicketCommentContent content={body} />
      </div>
      {long ? (
        // The system's chromeless action, not a hand-rolled copy of it. The
        // tone is `muted`, not the coral it used to hard-code: the bubble is a
        // white card, and a stratum deep is only ink-legal on its own ground.
        <QuietLink
          tone="muted"
          size={11.5}
          onClick={() => setExpanded((value) => !value)}
          testId="ticket-comment-expand"
          className="mt-1"
        >
          {expanded ? t("comment.collapse") : t("comment.expand")}
        </QuietLink>
      ) : null}
    </div>
  );
}
