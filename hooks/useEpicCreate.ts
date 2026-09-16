"use client";
import { useScopedMutation } from "@/hooks/useScopedMutation";

import { useTranslations } from "next-intl";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { epicInMessage } from "@/components/chat-page/message-epics";
import type { ChatSendResult } from "@/hooks/useChat";

/** How long to wait for a finalization reply to land before giving up. */
const FINALIZE_TIMEOUT_MS = 180_000;
const FINALIZE_POLL_INTERVAL_MS = 2_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface HistoryMessage {
  role: string;
  content: string;
}

interface UseEpicCreateOptions {
  projectId: string;
  conversationId: string | null;
  sendMessage?: (content: string, attachmentIds?: string[], options?: { finalize?: boolean }) => Promise<ChatSendResult | boolean | void>;
}

/**
 * True once ONE assistant message declares a whole epic — the exact condition
 * under which `ChatThread` renders a `DraftedEpicCard` for it. Parsing the
 * whole history instead (what this hook used to do) could stitch an epic out of
 * several replies that no card will ever show.
 */
function hasDraftedEpic(messages: readonly HistoryMessage[]): boolean {
  return messages.some((message) => epicInMessage(message) !== null);
}

/**
 * The finalisation half of creating an epic from a conversation.
 *
 * THIS HOOK NEVER CREATES THE EPIC. It used to — `POST /epics` with
 * `status: "backlog"` and no `type` — while the in-thread `DraftedEpicCard`
 * created the same epic with `todo|backlog` and `type: "feature"`: two
 * creators with two payloads for one conversation. The card is now the only
 * creator (it also owns Send to dev and Edit stories). What remains here is
 * the part the card cannot do: ask the agent, in up to two finalisation turns,
 * to write the epic as one parseable message, and wait until that reply is
 * really persisted. Resolves `true` when a drafted epic is in the history —
 * the card is then on screen and the user acts from it.
 */
export function useEpicCreate({ projectId, conversationId, sendMessage }: UseEpicCreateOptions) {
  const tErrors = useTranslations("ClientErrors");
  const scope = JSON.stringify([projectId, conversationId]);
  const owner = useMemo(() => ({ scope }), [scope]);
  const activeOwner = useRef<{ scope: string } | null>(owner);
  const mutation = useScopedMutation(scope);
  const [states, setStates] = useState<Record<string, { isLoading: boolean; error: string | null }>>({});
  const state = states[scope] ?? { isLoading: false, error: null };
  useEffect(() => {
    activeOwner.current = owner;
    return () => { activeOwner.current = null; };
  }, [owner]);
  const setError = useCallback((error: string | null) => {
    setStates((current) => ({ ...current, [scope]: { ...current[scope], error } }));
  }, [scope]);

  const { run: mutationRun } = mutation;
  const draftEpic = useCallback(
    async (): Promise<boolean> => {
      if (activeOwner.current !== owner) return false;

      const finalize = async (): Promise<boolean> => {
        if (!conversationId) {
          setError(tErrors("selectAnEpicCreationConversationFirst"));
          return false;
        }

        const loadMessages = async (): Promise<HistoryMessage[] | null> => {
          const res = await fetch(
            `/api/projects/${projectId}/chat?conversationId=${conversationId}`
          );
          if (!res.ok) return null;
          const json = await res.json();
          return Array.isArray(json.data) ? json.data : null;
        };

        const countAssistant = (list: Array<{ role: string }>) =>
          list.filter((message) => message.role === "assistant").length;

        let messages = await loadMessages();
        if (!messages) {
          setError(tErrors("unableToLoadTheConversationTryAgain"));
          return false;
        }
        if (messages.length === 0) {
          setError(tErrors("noMessagesFoundInThisConversationYet"));
          return false;
        }

        // The common case: the agent already answered with the epic, and its
        // card is already in the thread. Nothing to send.
        if (hasDraftedEpic(messages)) return true;
        if (!sendMessage) {
          setError(tErrors("iCouldntExtractAFullEpicYetAskClaudeToProvideAnEpicTitleAndUserStoriesFirst"));
          return false;
        }

        const MAX_ATTEMPTS = 2;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          // AGENT-FACING prompts, not catalogue copy: a model reads them.
          const prompt =
            attempt === 0
              ? "Generate the final epic with user stories based on our discussion."
              : 'Output ONLY the JSON code block for the epic. Start your response with ```json and end with ```. No other text.';
          const assistantCountBefore = countAssistant(messages);
          const sent = await sendMessage(prompt, [], { finalize: true });
          if (sent === false || (sent && typeof sent === "object" && (!sent.accepted || sent.error))) {
            setError((sent && typeof sent === "object" && sent.error) || tErrors("failedToSendMessage"));
            return false;
          }

          // `sendMessage` can resolve before the reply is persisted (aborted
          // stream, conversation switched while generating). Poll until a new
          // assistant message actually lands instead of judging stale rows and
          // reporting a failure the user then sees contradicted on screen.
          const deadline = Date.now() + FINALIZE_TIMEOUT_MS;
          while (true) {
            const updated = await loadMessages();
            if (updated && updated.length > 0) messages = updated;
            if (hasDraftedEpic(messages)) return true;
            // A reply landed but it is not parseable — let the next attempt
            // ask again rather than waiting out the timeout.
            if (countAssistant(messages) > assistantCountBefore) break;
            if (Date.now() >= deadline) break;
            await delay(FINALIZE_POLL_INTERVAL_MS);
          }
        }

        setError(tErrors("iCouldntExtractAFullEpicYetAskClaudeToProvideAnEpicTitleAndUserStoriesFirst"));
        return false;
      };

      // Progress stays with its conversation, including a return to it before
      // completion; a switch away never inherits another conversation's error.
      const result = await mutationRun(async () => {
        setStates((current) => ({ ...current, [scope]: { isLoading: true, error: null } }));
        return finalize();
      }, tErrors("failedToDraftEpic")); // It drafts; the in-thread card creates (#52).
      setStates((current) => ({ ...current, [scope]: { ...current[scope], isLoading: false } }));
      if (activeOwner.current?.scope !== scope) return false;
      return result === true;
    },
    [projectId, conversationId, sendMessage, tErrors, scope, owner, setError, mutationRun]
  );

  return { draftEpic, isLoading: mutation.pending || state.isLoading, error: state.error || mutation.error };
}
