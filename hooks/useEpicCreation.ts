"use client";

import { useState, useCallback } from "react";

export interface EpicChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function useEpicCreation(projectId: string) {
  const [messages, setMessages] = useState<EpicChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: EpicChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content,
      };

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setSending(true);

      try {
        const res = await fetch(`/api/projects/${projectId}/epic-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        const json = await res.json();

        if (json.error) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              content: `Error: ${json.error}`,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              content: json.data.content,
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: "Error: Failed to reach the server.",
          },
        ]);
      }

      setSending(false);
    },
    [messages, projectId],
  );

  const createEpic = useCallback(async (): Promise<string | null> => {
    setCreating(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/epic-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const json = await res.json();

      if (json.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: `Error creating epic: ${json.error}`,
          },
        ]);
        setCreating(false);
        return null;
      }

      setCreating(false);
      return json.data.epicId as string;
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "Error: Failed to create epic.",
        },
      ]);
      setCreating(false);
      return null;
    }
  }, [messages, projectId]);

  const reset = useCallback(() => {
    setMessages([]);
    setSending(false);
    setCreating(false);
  }, []);

  return { messages, sending, creating, sendMessage, createEpic, reset };
}
