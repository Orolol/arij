"use client";

import { useState, useEffect, useCallback } from "react";

interface ChatMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  metadata?: string;
  createdAt: string;
}

export function useChat(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/chat`);
      const data = await res.json();
      setMessages(data.data || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const sendMessage = useCallback(
    async (content: string) => {
      setSending(true);
      // Optimistically add user message
      const tempId = `temp-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          projectId,
          role: "user",
          content,
          createdAt: new Date().toISOString(),
        },
      ]);

      try {
        const res = await fetch(`/api/projects/${projectId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const data = await res.json();
        // Reload all messages to get the assistant response
        await loadMessages();
      } catch {
        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
      setSending(false);
    },
    [projectId, loadMessages]
  );

  return { messages, loading, sending, sendMessage, refresh: loadMessages };
}
