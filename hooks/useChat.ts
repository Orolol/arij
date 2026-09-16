"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback, useRef } from "react";
import { createId } from "@/lib/utils/nanoid";
import type { QuestionData } from "@/lib/claude/spawn";
import { fetchChatHistory, streamChatMessage, type ChatMessage, type ChatSendResult } from "@/lib/chat/client";

export type { ChatAttachment, ChatMessage, ChatSendResult } from "@/lib/chat/client";

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  pendingQuestions: QuestionData[] | null;
  streamStatus: string | null;
}

function emptyChat(loading: boolean): ChatState {
  return { messages: [], loading, sending: false, error: null, pendingQuestions: null, streamStatus: null };
}

interface ActiveStream {
  controller: AbortController;
  awaitingAnswer: boolean;
  pendingQuestions: QuestionData[] | null;
}

export function useChat(projectId: string, conversationId: string | null, conversationStatus?: string | null) {
  const tErrors = useTranslations("ClientErrors");
  const scope = JSON.stringify([projectId, conversationId]);
  // Conversation state survives navigation while its stream continues. Keeping
  // it here avoids rebuilding visible questions/progress from refs in an effect.
  const [states, setStates] = useState<Record<string, ChatState>>({});
  const state = states[scope] ?? emptyChat(Boolean(conversationId));
  const streams = useRef(new Map<string, ActiveStream>());
  const historyLoads = useRef(new Map<string, object>());
  const update = useCallback((change: (current: ChatState) => ChatState) => {
    setStates((current) => ({ ...current, [scope]: change(current[scope] ?? emptyChat(Boolean(conversationId))) }));
  }, [scope, conversationId]);

  const loadMessages = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    const request = {};
    historyLoads.current.set(scope, request);
    return fetchChatHistory(`/api/projects/${projectId}/chat?conversationId=${conversationId}`,
      tErrors("unableToLoadTheConversationTryAgain")).then((result) => {
      if (historyLoads.current.get(scope) !== request) return;
      historyLoads.current.delete(scope);
      update((current) => result.error === null
        ? { ...current, messages: result.data, loading: false, error: null }
        : { ...current, loading: false, error: result.error });
    });
  }, [projectId, conversationId, scope, update, tErrors]);

  useEffect(() => {
    if (!streams.current.has(scope)) void loadMessages();
  }, [loadMessages, scope]);
  const previousStatus = useRef(conversationStatus);
  useEffect(() => {
    // Also catch up when a background turn finishes after this hook remounted.
    if (previousStatus.current !== conversationStatus && !streams.current.has(scope)) void loadMessages();
    previousStatus.current = conversationStatus;
  }, [loadMessages, conversationStatus, scope]);

  const sendMessage = useCallback(
    async (content: string, attachmentIds?: string[], options?: { finalize?: boolean }): Promise<ChatSendResult> => {
      if (!conversationId) return { accepted: false, error: null };
      const previous = streams.current.get(scope);
      if (previous && !previous.awaitingAnswer) return { accepted: false, error: null };
      previous?.controller.abort();
      const stream: ActiveStream = { controller: new AbortController(), awaitingAnswer: false, pendingQuestions: null };
      streams.current.set(scope, stream);
      historyLoads.current.delete(scope);
      const updateStream = (change: (current: ChatState) => ChatState) => {
        if (streams.current.get(scope) === stream) update(change);
      };
      const userTempId = `temp-user-${createId()}`;
      const assistantTempId = `temp-assistant-${createId()}`;
      const createdAt = new Date().toISOString();
      updateStream((current) => ({
        ...current, sending: true, loading: false, pendingQuestions: null, streamStatus: null, error: null,
        messages: [...current.messages,
          { id: userTempId, projectId, role: "user", content, createdAt },
          { id: assistantTempId, projectId, role: "assistant", content: "", createdAt },
        ],
      }));

      // Switching tabs does not cancel the response: cancelling it can kill
      // server-side generation. All events update their owning conversation.
      const result = await streamChatMessage(`/api/projects/${projectId}/chat/stream`,
        { content, conversationId, attachmentIds, finalize: options?.finalize }, stream.controller.signal,
        async (event) => {
          if (event.status) updateStream((current) => ({ ...current, streamStatus: event.status ?? null }));
          if (event.delta) updateStream((current) => ({ ...current, streamStatus: null,
            messages: current.messages.map((message) => message.id === assistantTempId
              ? { ...message, content: message.content + event.delta } : message),
          }));
          if (event.questions) {
            stream.awaitingAnswer = true;
            stream.pendingQuestions = event.questions;
            updateStream((current) => ({ ...current, pendingQuestions: event.questions ?? null,
              sending: false, streamStatus: null }));
          }
          if (event.done && streams.current.get(scope) === stream) await loadMessages();
        }, { request: tErrors("streamRequestFailed"), send: tErrors("failedToSendMessage") });

      if (result.error) {
        if (!result.accepted && previous?.pendingQuestions) {
          stream.awaitingAnswer = true;
          stream.pendingQuestions = previous.pendingQuestions;
        }
        // Accepted requests already own the user message and its images. Sync
        // that durable history without turning it back into an unsent draft.
        if (result.accepted && streams.current.get(scope) === stream) await loadMessages();
        updateStream((current) => ({ ...current, pendingQuestions: stream.pendingQuestions,
          messages: current.messages.filter((message) =>
            (result.accepted || message.id !== userTempId) && message.id !== assistantTempId),
          error: result.error,
        }));
      }
      updateStream((current) => ({ ...current, sending: false, streamStatus: null }));
      // Questions remain actionable after SSE closes, until the next answer.
      if (streams.current.get(scope) === stream && !stream.awaitingAnswer) streams.current.delete(scope);
      return result;
    },
    [projectId, conversationId, scope, update, loadMessages, tErrors],
  );

  const answerQuestions = useCallback((formatted: string) => { void sendMessage(formatted); }, [sendMessage]);

  return {
    messages: state.messages, loading: state.loading,
    sending: state.sending, error: state.error, pendingQuestions: state.pendingQuestions,
    streamStatus: state.streamStatus, sendMessage, answerQuestions, refresh: loadMessages,
  };
}
