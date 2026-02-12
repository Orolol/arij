"use client";

import { useState, useEffect, useCallback } from "react";

interface Conversation {
  id: string;
  projectId: string;
  type: "brainstorm" | "epic";
  label: string;
  epicId: string | null;
  provider: string;
  createdAt: string;
}

export function useConversations(projectId: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`);
      const json = await res.json();
      const data: Conversation[] = json.data || [];
      setConversations(data);

      // Set active to first conversation if none selected or current is gone
      if (data.length > 0) {
        setActiveId((prev) => {
          if (prev && data.some((c) => c.id === prev)) return prev;
          return data[0].id;
        });
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createConversation = useCallback(
    async (type: "brainstorm" | "epic", label: string) => {
      try {
        const res = await fetch(`/api/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, label }),
        });
        const json = await res.json();
        if (json.data) {
          setConversations((prev) => [...prev, json.data]);
          setActiveId(json.data.id);
          return json.data as Conversation;
        }
      } catch {
        // ignore
      }
      return null;
    },
    [projectId]
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      try {
        await fetch(`/api/projects/${projectId}/conversations/${conversationId}`, {
          method: "DELETE",
        });
        // Remove from local state
        setConversations((prev) => {
          const next = prev.filter((c) => c.id !== conversationId);
          // Adjust active if the deleted one was active
          setActiveId((prevActive) => {
            if (prevActive === conversationId && next.length > 0) {
              return next[0].id;
            }
            if (next.length === 0) return null;
            return prevActive;
          });
          return next;
        });
      } catch {
        // ignore
      }
    },
    [projectId]
  );

  return { conversations, activeId, setActiveId, loading, createConversation, deleteConversation, refresh };
}
