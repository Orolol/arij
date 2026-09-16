"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConversations } from "@/hooks/useConversations";
import { useChat } from "@/hooks/useChat";
import { useEpicCreate } from "@/hooks/useEpicCreate";
import { useSpecGeneration } from "@/hooks/useSpecGeneration";
import type { AgentSelection } from "@/components/shared/AgentSelectPill";
import { agentSelectionPatch, selectionForConversation } from "@/components/chat-page/agent-selection";
import { isBrainstormConversationAgentType, isEpicCreationConversationAgentType } from "@/lib/chat/conversation-agent";
import { isLegacyConversationGenerating } from "@/lib/chat/parity-contract";
import { OPENAI_COMPATIBLE_PROVIDER } from "@/lib/agent-config/constants";

/** Shared conversation actions for the full page and the project side panel. */
export function useChatWorkspace(projectId: string, onEpicCreated?: () => void) {
  const router = useRouter();
  const conversations = useConversations(projectId);
  const { activeId, hasPendingMutation, updateConversation } = conversations;
  const activeConversation = useMemo(() => conversations.conversations.find((row) => row.id === activeId) ?? null,
    [conversations.conversations, activeId]);
  const chat = useChat(projectId, activeId, activeConversation?.status);
  const epic = useEpicCreate({ projectId, conversationId: activeId, sendMessage: chat.sendMessage });
  // Grounded on the conversation the user is looking at, not the project's
  // most recent chat (lot 11, #108).
  const spec = useSpecGeneration(projectId, { conversationId: activeId });
  const { sendMessage: rawSendMessage } = chat;
  const { createEpic: rawCreateEpic } = epic;
  const { generateSpec: rawGenerateSpec, generating: generatingSpec } = spec;
  const [lastSend, setLastSend] = useState<{ conversationId: string; at: string } | null>(null);
  const hasMessages = chat.messages.length > 0;
  const hasUserMessage = chat.messages.some((message) => message.role === "user");
  const streamBusy = chat.loading || chat.sending
    || (isLegacyConversationGenerating(activeConversation?.status) && !chat.pendingQuestions);
  const busy = streamBusy || Boolean(conversations.mutating) || (epic.isLoading && !chat.pendingQuestions);
  const activeProvider = activeConversation?.provider || "claude-code";

  const sendMessage = useCallback(async (content: string, attachmentIds: string[]) => {
    if (!activeId || busy || hasPendingMutation?.()) return { accepted: false, error: null };
    setLastSend({ conversationId: activeId, at: new Date().toISOString() });
    return rawSendMessage(content, attachmentIds);
  }, [activeId, busy, hasPendingMutation, rawSendMessage]);

  const selectAgent = useCallback(async (choice: AgentSelection) => {
    if (!activeId || busy || hasMessages) return;
    const patch = agentSelectionPatch(choice);
    if (patch) await updateConversation(activeId, patch);
  }, [activeId, busy, hasMessages, updateConversation]);

  const createEpic = useCallback(async () => {
    if (busy || !hasUserMessage) return;
    const epicId = await rawCreateEpic();
    if (epicId) {
      onEpicCreated?.();
      router.refresh();
    }
  }, [busy, hasUserMessage, rawCreateEpic, onEpicCreated, router]);

  const generateSpec = useCallback(async () => {
    if (busy || !hasUserMessage || generatingSpec) return null;
    return rawGenerateSpec();
  }, [busy, hasUserMessage, generatingSpec, rawGenerateSpec]);

  return {
    ...conversations,
    ...chat,
    conversationsLoading: conversations.loading,
    activeConversation,
    activeProvider,
    activeAgentSelection: selectionForConversation(activeConversation),
    hasMessages, hasUserMessage, busy,
    agentLocked: !activeConversation || busy || hasMessages,
    attachmentsDisabled: activeProvider === OPENAI_COMPATIBLE_PROVIDER,
    isBrainstorm: isBrainstormConversationAgentType(activeConversation?.type),
    isEpicCreation: isEpicCreationConversationAgentType(activeConversation?.type),
    error: conversations.error || epic.error || spec.error || chat.error,
    refreshConversations: conversations.refresh,
    sendStartedAt: lastSend?.conversationId === activeId ? lastSend.at : null,
    sendMessage, selectAgent, createEpic, generateSpec,
    epicCreating: epic.isLoading,
    generatingSpec: spec.generating,
    specResult: spec.result,
    actionsDisabled: busy || !hasUserMessage,
  };
}
