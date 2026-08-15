"use client";

import { Loader2, MessageSquare, Plus, Sparkles, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Conversation } from "@/hooks/useConversations";
import { isEpicCreationConversationAgentType } from "@/lib/chat/conversation-agent";
import {
  isLegacyConversationGenerating,
  resolveLegacyConversationLabel,
} from "@/lib/chat/parity-contract";
import { cn } from "@/lib/utils";

function truncateLabel(label: string) {
  if (label.length <= 20) return label;
  return `${label.slice(0, 20)}...`;
}

interface ChatTabBarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelectTab: (conversationId: string) => void;
  onCloseTab: (conversationId: string) => void;
  onCreateTab: (options: { type: string; label: string }) => void;
}

export function ChatTabBar({
  conversations,
  activeId,
  onSelectTab,
  onCloseTab,
  onCreateTab,
}: ChatTabBarProps) {
  return (
    <div
      className="border-b border-border flex items-center gap-0 overflow-x-auto"
      data-testid="chat-tab-bar"
    >
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeId;
        return (
          <button
            key={conversation.id}
            type="button"
            data-testid={`conversation-tab-${conversation.id}`}
            data-agent-type={
              isEpicCreationConversationAgentType(conversation.type)
                ? "epic_creation"
                : "brainstorm"
            }
            onClick={() => onSelectTab(conversation.id)}
            className={cn(
              "group flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {isEpicCreationConversationAgentType(conversation.type) ? (
              <Sparkles className="h-3 w-3" />
            ) : (
              <MessageSquare className="h-3 w-3" />
            )}
            <span>
              {truncateLabel(
                resolveLegacyConversationLabel(
                  conversation.type,
                  conversation.label,
                ),
              )}
            </span>
            {isLegacyConversationGenerating(conversation.status) && (
              <Loader2
                data-testid={`active-indicator-${conversation.id}`}
                className="h-3 w-3 animate-spin text-primary"
                aria-label="Agent active"
              />
            )}
            {conversations.length > 1 && (
              <span
                role="button"
                data-testid={`close-tab-${conversation.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(conversation.id);
                }}
                className="ml-1 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="new-conversation-tab"
            className="flex items-center justify-center w-7 h-7 mx-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="New conversation"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            data-testid="new-tab-brainstorm"
            onClick={() => onCreateTab({ type: "brainstorm", label: "Brainstorm" })}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Brainstorm
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="new-tab-epic"
            onClick={() => onCreateTab({ type: "epic_creation", label: "New Epic" })}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            New Epic
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
