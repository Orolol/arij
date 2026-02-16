"use client";

import { useState, useCallback } from "react";
import { parseEpicFromConversation } from "@/lib/epic-parsing";

interface EpicCreateResult {
  epicId: string;
  title: string;
  userStoriesCreated: number;
}

interface UseEpicCreateOptions {
  projectId: string;
  conversationId: string | null;
  sendMessage?: (content: string, attachmentIds?: string[], options?: { finalize?: boolean }) => Promise<void>;
  onEpicCreated?: (result: EpicCreateResult) => void;
}

export function useEpicCreate({ projectId, conversationId, sendMessage, onEpicCreated }: UseEpicCreateOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEpic, setCreatedEpic] = useState<EpicCreateResult | null>(null);

  const createEpic = useCallback(
    async (): Promise<string | null> => {
      setIsLoading(true);
      setError(null);
      setCreatedEpic(null);

      try {
        if (!conversationId) {
          setError("Select an epic creation conversation first.");
          return null;
        }

        const messagesRes = await fetch(
          `/api/projects/${projectId}/chat?conversationId=${conversationId}`
        );
        if (!messagesRes.ok) {
          setError("Unable to load the conversation. Try again.");
          return null;
        }
        const messagesJson = await messagesRes.json();
        let messages: Array<{ role: string; content: string }> =
          messagesJson.data || [];

        if (messages.length === 0) {
          setError("No messages found in this conversation yet.");
          return null;
        }

        // Try up to 2 finalization attempts — second attempt uses a stronger nudge.
        const MAX_ATTEMPTS = 2;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          if (sendMessage) {
            const prompt =
              attempt === 0
                ? "Generate the final epic with user stories based on our discussion."
                : 'Output ONLY the JSON code block for the epic. Start your response with ```json and end with ```. No other text.';
            await sendMessage(prompt, [], { finalize: true });

            const updatedRes = await fetch(
              `/api/projects/${projectId}/chat?conversationId=${conversationId}`
            );
            if (updatedRes.ok) {
              const updatedJson = await updatedRes.json();
              const updatedMessages: Array<{ role: string; content: string }> =
                updatedJson.data || [];
              if (updatedMessages.length > 0) {
                messages = updatedMessages;
              }
            }
          }

          const parsedEpic = parseEpicFromConversation(messages);
          if (parsedEpic) {
            const res = await fetch(`/api/projects/${projectId}/epics`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: parsedEpic.title,
                description: parsedEpic.description,
                status: "backlog",
                userStories: parsedEpic.userStories,
              }),
            });

            const json = await res.json();

            if (!res.ok || json.error) {
              setError(json.error || "Failed to create epic");
              return null;
            }

            const result: EpicCreateResult = {
              epicId: json.data?.id || json.data?.epicId,
              title: json.data?.title || parsedEpic.title,
              userStoriesCreated:
                typeof json.data?.userStoriesCreated === "number"
                  ? json.data.userStoriesCreated
                  : parsedEpic.userStories.length,
            };

            if (!result.epicId) {
              setError("Epic was created but no epic ID was returned.");
              return null;
            }

            setCreatedEpic(result);
            onEpicCreated?.(result);
            return result.epicId;
          }
        }

        setError(
          "I couldn't extract a full epic yet. Ask Claude to provide an epic title and user stories first.",
        );
        return null;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create epic";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, conversationId, sendMessage, onEpicCreated]
  );

  return { createEpic, isLoading, error, createdEpic };
}
