"use client";

import { useCallback, useMemo } from "react";

import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";
import type { Conversation } from "@/hooks/useConversations";
import {
  PROVIDER_LABELS,
  type ChatModeProvider,
} from "@/lib/agent-config/constants";

/**
 * Who is talking, per conversation: the named agent's name when there is
 * one, else the provider's label, else the raw provider string. Shared by the
 * chat page and the project panel so a roster row and a bubble kicker can
 * never name the same conversation differently.
 */
export function useConversationAgentLabels(
  conversations: readonly Conversation[],
  activeConversation: Conversation | null,
) {
  const { agents } = useNamedAgentsList();

  const agentLabelFor = useCallback(
    (conversation: { namedAgentId?: string | null; provider: string }) => {
      if (conversation.namedAgentId) {
        const named = agents?.find((row) => row.id === conversation.namedAgentId);
        if (named?.name) return named.name;
      }
      const provider = conversation.provider;
      return (
        PROVIDER_LABELS[provider as ChatModeProvider] ??
        provider ??
        "—"
      );
    },
    [agents],
  );

  const agentLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const conversation of conversations) {
      map.set(conversation.id, agentLabelFor(conversation));
    }
    return map;
  }, [conversations, agentLabelFor]);

  const activeAgentLabel = activeConversation
    ? agentLabelFor(activeConversation)
    : "—";

  return { agentLabels, activeAgentLabel };
}
