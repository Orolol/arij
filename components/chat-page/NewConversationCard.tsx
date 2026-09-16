"use client";

import * as React from "react";
import { MessageCircle, MessageSquare, Plus, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BRAINSTORM_AGENT_TYPE,
  CHAT_AGENT_TYPE,
  EPIC_CREATION_AGENT_TYPE,
} from "@/lib/chat/conversation-agent";
import {
  BRAINSTORM_CONVERSATION_LABEL,
  CHAT_CONVERSATION_LABEL,
  EPIC_CREATION_CONVERSATION_LABEL,
} from "@/lib/chat/conversation-labels";

/**
 * The dashed "New conversation" affordance at the foot of the roster — the
 * only conversation creator on either chat surface (the project panel mounts
 * the same roster).
 *
 * THREE ENTRIES, AND "Chat" IS NOT OPTIONAL. Brainstorm and epic creation are
 * strict prompt contracts, so every tool surface (board tools, the CLI tool
 * channel) is gated off for them (`isToolIneligibleConversationAgentType`). A
 * `chat` conversation is the only one that can list tickets or start a build;
 * a menu without it left `/chat` unable to ever reach those tools.
 *
 * NOT a `SelectPill`: this is a full-width dashed card, not a 30px pill, and
 * the pill primitive is a fixed-height inline trigger.
 */
export interface NewConversationCardProps {
  onCreate: (options: { type: string; label: string }) => void;
  disabled?: boolean;
}

export function NewConversationCard({
  onCreate,
  disabled = false,
}: NewConversationCardProps) {
  const t = useTranslations("Chat");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="chat-new-conversation"
          disabled={disabled}
          className={[
            "flex shrink-0 items-center gap-[7px] rounded-[14px]",
            "border-[1.5px] border-dashed border-border-strong",
            "px-[15px] py-[14px] text-[13px] font-semibold text-foreground",
            "outline-none transition-colors hover:border-foreground",
            "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            "motion-reduce:transition-none",
          ].join(" ")}
        >
          <Plus size={14} aria-hidden="true" />
          {t("roster.newConversation")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="rounded-[12px] border-[1.5px] border-border bg-card shadow-none"
      >
        {/*
          The `label` in each payload is NOT copy: it is written to
          `chat_conversations.label` and doubles as the "not named yet"
          sentinel of title generation, so it comes from the shared constants
          (lib/chat/conversation-labels.ts). Only the visible entry is a key.
        */}
        <DropdownMenuItem
          data-testid="chat-new-conversation-chat"
          onSelect={() =>
            onCreate({ type: CHAT_AGENT_TYPE, label: CHAT_CONVERSATION_LABEL })
          }
        >
          <MessageCircle aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("roster.newChat")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="chat-new-conversation-brainstorm"
          onSelect={() =>
            onCreate({
              type: BRAINSTORM_AGENT_TYPE,
              label: BRAINSTORM_CONVERSATION_LABEL,
            })
          }
        >
          <MessageSquare aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("roster.newBrainstorm")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="chat-new-conversation-epic"
          onSelect={() =>
            onCreate({
              type: EPIC_CREATION_AGENT_TYPE,
              label: EPIC_CREATION_CONVERSATION_LABEL,
            })
          }
        >
          <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("roster.newEpic")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
