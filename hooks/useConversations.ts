"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { sortConversationsForLegacyParity } from "@/lib/chat/parity-contract";

export interface Conversation {
  id: string;
  projectId: string;
  type: string;
  label: string;
  status?: string | null;
  epicId: string | null;
  provider: string;
  namedAgentId?: string | null;
  cliSessionId?: string | null;
  persistentSessionState?: "hot" | "cold" | null;
  createdAt: string;
}

export interface CreateConversationInput {
  type?: string;
  label?: string;
  epicId?: string | null;
  provider?: string;
  namedAgentId?: string | null;
}

export interface UpdateConversationInput {
  type?: string;
  label?: string;
  provider?: string;
  namedAgentId?: string | null;
}

interface ConversationState {
  scope: { projectId: string };
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;
  request: object | null;
  loadError: string | null;
  mutationError: string | null;
  mutating: boolean;
}

function emptyConversations(scope: { projectId: string }): ConversationState {
  return { scope, conversations: [], activeId: null, loading: true, request: null, loadError: null, mutationError: null, mutating: false };
}

function withConversations(state: ConversationState, rows: Conversation[]): ConversationState {
  const conversations = sortConversationsForLegacyParity(rows);
  const activeId = conversations.some((conversation) => conversation.id === state.activeId)
    ? state.activeId : conversations[0]?.id ?? null;
  return { ...state, conversations, activeId };
}

export function useConversations(projectId: string) {
  const t = useTranslations("ChatLegacy");
  const pending = useRef(new Set<object>());
  const scope = useMemo(() => ({ projectId }), [projectId]);
  const [state, setState] = useState(() => emptyConversations(scope));
  if (state.scope !== scope) setState(emptyConversations(scope));

  const update = useCallback((change: (current: ConversationState) => ConversationState) => {
    setState((current) => current.scope === scope ? change(current) : current);
  }, [scope]);
  const conversationsUrl = `/api/projects/${projectId}/conversations`;

  const refresh = useCallback(async () => {
    const request = {};
    update((current) => ({ ...current, request }));
    try {
      const res = await fetch(conversationsUrl);
      const json = await res.json();
      if (res.ok && Array.isArray(json.data)) {
        update((current) => current.request === request
          ? { ...withConversations(current, json.data), loadError: null } : current);
      } else {
        update((current) => current.request === request
          ? { ...current, loadError: json.error || t("conversations.loadFailed") } : current);
      }
    } catch {
      update((current) => current.request === request
        ? { ...current, loadError: t("conversations.loadFailed") } : current);
    }
    update((current) => current.request === request
      ? { ...current, loading: false, request: null } : current);
  }, [conversationsUrl, update, t]);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  const setActiveId = useCallback((activeId: string | null) => {
    update((current) => ({ ...current, activeId }));
  }, [update]);

  // One write at a time: a first message must not race an agent change, and
  // repeated create clicks must not create several permanent conversations.
  const mutate = useCallback(async <T,>(
    request: () => Promise<T>,
    fallback: string,
  ): Promise<T | null> => {
    if (pending.current.has(scope)) return null;
    pending.current.add(scope);
    update((current) => ({ ...current, mutating: true, mutationError: null }));
    const value = await request().catch((error: unknown) => {
      update((current) => ({ ...current,
        mutationError: error instanceof Error ? error.message : fallback }));
      return null;
    });
    pending.current.delete(scope);
    update((current) => ({ ...current, mutating: false }));
    return value;
  }, [scope, update]);

  // Successful mutations invalidate older list reads.
  const saveConversation = useCallback((
    method: "POST" | "PATCH",
    input: CreateConversationInput | UpdateConversationInput,
    conversationId?: string,
  ) => {
    const fallback = method === "POST" ? t("conversations.createFailed") : t("conversations.updateFailed");
    return mutate(async () => {
      const res = await fetch(conversationId ? `${conversationsUrl}/${conversationId}` : conversationsUrl, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.data?.id) {
        throw new Error(json.error || fallback);
      }
      const saved = json.data as Conversation;
      update((current) => ({
        ...withConversations(current, [...current.conversations.filter((row) => row.id !== saved.id), saved]),
        ...(method === "POST" ? { activeId: saved.id } : {}),
        loading: false, request: null,
      }));
      return saved;
    }, fallback);
  }, [conversationsUrl, update, mutate, t]);

  const createConversation = useCallback((input: CreateConversationInput = {}) =>
    saveConversation("POST", input), [saveConversation]);
  const updateConversation = useCallback((conversationId: string, input: UpdateConversationInput) =>
    saveConversation("PATCH", input, conversationId), [saveConversation]);

  const deleteConversation = useCallback(async (conversationId: string) => Boolean(await mutate(async () => {
    const res = await fetch(`${conversationsUrl}/${conversationId}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || t("conversations.deleteFailed"));
    }
    update((current) => ({
      ...withConversations(current, current.conversations.filter((row) => row.id !== conversationId)),
      loading: false, request: null,
    }));
    return true;
  }, t("conversations.deleteFailed"))), [conversationsUrl, update, mutate, t]);

  const restartPersistentSession = useCallback(async (conversationId: string) => Boolean(await mutate(async () => {
    const res = await fetch(`${conversationsUrl}/${conversationId}/persistent-session`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || t("conversations.restartFailed"));
    }
    update((current) => ({ ...current, request: null, loading: false,
      conversations: current.conversations.map((conversation) => conversation.id === conversationId
        ? { ...conversation, persistentSessionState: "cold" } : conversation),
    }));
    return true;
  }, t("conversations.restartFailed"))), [conversationsUrl, update, mutate, t]);

  const hasPendingMutation = useCallback(() => pending.current.has(scope), [scope]);

  return {
    conversations: state.conversations, activeId: state.activeId, loading: state.loading,
    hasPendingMutation,
    error: state.mutationError || state.loadError, mutating: state.mutating,
    setActiveId, createConversation, updateConversation, deleteConversation,
    restartPersistentSession, refresh,
  };
}
