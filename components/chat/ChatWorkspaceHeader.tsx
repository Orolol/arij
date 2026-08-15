"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import type { Conversation } from "@/hooks/useConversations";
import { resolveLegacyConversationLabel } from "@/lib/chat/parity-contract";

interface ChatWorkspaceHeaderProps {
  activeConversation: Conversation | null;
  activeProvider: string;
  hasMessages: boolean;
  isBusy: boolean;
  onAgentChange: (namedAgentId: string) => void;
  showGenerateSpec: boolean;
  generatingSpec: boolean;
  onGenerateSpec: () => void;
  showCreateEpic: boolean;
  epicCreating: boolean;
  onCreateEpic: () => void;
}

export function ChatWorkspaceHeader({
  activeConversation,
  activeProvider,
  hasMessages,
  isBusy,
  onAgentChange,
  showGenerateSpec,
  generatingSpec,
  onGenerateSpec,
  showCreateEpic,
  epicCreating,
  onCreateEpic,
}: ChatWorkspaceHeaderProps) {
  return (
    <div className="p-3 border-b border-border flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h3 className="font-medium text-sm">
          {resolveLegacyConversationLabel(
            activeConversation?.type,
            activeConversation?.label,
          )}
        </h3>
        {activeConversation?.cliSessionId && (
          <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/30">
            session linked
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span data-testid="provider-select" className="sr-only">
          {activeProvider}
        </span>
        <NamedAgentSelect
          value={activeConversation?.namedAgentId ?? null}
          onChange={onAgentChange}
          disabled={!activeConversation || hasMessages || isBusy}
          className="w-44 h-7 text-xs"
        />
        {showGenerateSpec && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onGenerateSpec}
            disabled={generatingSpec}
            className="text-xs"
          >
            {generatingSpec ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            Generate Spec & Plan
          </Button>
        )}
        {showCreateEpic && (
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={onCreateEpic}
            disabled={epicCreating}
            className="text-xs"
          >
            {epicCreating ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            Create Epic & Generate Stories
          </Button>
        )}
      </div>
    </div>
  );
}
