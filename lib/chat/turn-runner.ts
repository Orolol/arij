/**
 * One chat turn, from "the user message is stored" to "the reply is stored".
 *
 * POST /chat/stream has five execution paths (OpenAI-compatible fast mode,
 * warm persistent CLI, one-shot non-Claude provider, Claude resume, Claude
 * fresh stream). Each used to build its own ReadableStream, activity
 * registration, reply persistence, tool-channel release and cancel handler,
 * and the copies had drifted: the persistent path never released anything,
 * only some paths tolerated a closed controller. This module owns that
 * lifecycle once; a path is a `ChatTurnStrategy` that only produces events.
 *
 * The SSE contract is unchanged: `data: {"delta"}`, `{"status"}`,
 * `{"questions"}` frames, then `{"done", messageId}` once the reply is stored.
 *
 * Server-only (`db`).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatConversations, chatMessages } from "@/lib/db/schema";
import { activityRegistry } from "@/lib/activity-registry";
import { createId } from "@/lib/utils/nanoid";
import { generateConversationTitle } from "@/lib/chat/title-generation";
import { isDefaultConversationLabel } from "@/lib/chat/conversation-labels";
import type { StreamChunk } from "@/lib/claude/spawn";

/** What a strategy streams: the provider's own chunk vocabulary. */
export type ChatTurnEvent = StreamChunk;

export type ChatConversationStatus = "active" | "generating" | "error";

export interface ChatTurnIO {
  /** The registered activity id — stable for the whole turn. */
  readonly activityId: string;
  /**
   * Sends one event to the client; text also accumulates into the reply.
   * Ignored once the client has disconnected: the reply is what they saw.
   */
  emit(event: ChatTurnEvent): void;
  /** Reply text accumulated so far. */
  readonly content: string;
}

export interface ChatTurnStrategy {
  /** Provider recorded on the activity row the monitor lists. */
  readonly provider: string;
  /**
   * What a kill (monitor or disconnect) means for this path.
   * - "stop": the turn ends quietly — what streamed is kept as a normal
   *   reply, nothing streamed means nothing stored (fast mode, whose abort
   *   is an AbortError, not a provider failure worth showing).
   * - "fail": whatever the provider reports after the kill is handled like
   *   any other outcome (a CLI's "turn cancelled" is shown and stored).
   */
  readonly onKill: "stop" | "fail";
  /**
   * Whether a turn the client walked away from still stores its reply. True
   * for the streaming CLI paths, whose partial output would otherwise be
   * lost; false where the reply only exists once the provider settles.
   */
  readonly persistAfterClientCancel: boolean;
  /** Runs the provider. Resolves with the conversation's final status. */
  run(io: ChatTurnIO): Promise<{ status: "active" | "error" }>;
  /** Stops the provider work currently running (retries included). */
  kill(): void;
  /** Frees per-turn resources (MCP token); called exactly once. */
  release?(): void;
  /** The assistant-visible line for a failure `run` threw. */
  describeFailure(error: unknown): string;
}

export interface RunChatTurnOptions {
  projectId: string;
  conversationId: string | null;
  /** The stored user message, for title generation. */
  userContent: string;
  activityLabel: string;
  namedAgentName: string | null;
  strategy: ChatTurnStrategy;
}

export function setConversationStatus(
  conversationId: string | null,
  status: ChatConversationStatus,
) {
  if (!conversationId) return;
  db.update(chatConversations)
    .set({ status })
    .where(eq(chatConversations.id, conversationId))
    .run();
}

/**
 * Stores the reply, then — on a conversation's first exchange, while its
 * label is still a creation default — asks for a generated title in the
 * background. Returns the stored message id.
 */
function storeReply(
  options: RunChatTurnOptions,
  content: string,
  status: "active" | "error",
): string {
  const { projectId, conversationId, userContent } = options;
  const assistantMsgId = createId();
  db.insert(chatMessages)
    .values({
      id: assistantMsgId,
      projectId,
      conversationId,
      role: "assistant",
      content: content || "(empty response)",
      createdAt: new Date().toISOString(),
    })
    .run();

  if (conversationId && content) {
    // Only "exactly two" matters (the first exchange), so read at most three
    // ids rather than every message of a conversation that keeps growing.
    const firstExchange =
      db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
        .limit(3)
        .all().length === 2;

    if (firstExchange) {
      const conversation = db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.id, conversationId))
        .get();
      if (conversation && isDefaultConversationLabel(conversation.label)) {
        void generateConversationTitle({
          projectId,
          userContent,
          assistantContent: content,
        })
          .then((title) => {
            if (title) {
              // Conditional on the label the decision was made on: titling
              // takes seconds, and a user who renamed the conversation in
              // that window must keep their name.
              db.update(chatConversations)
                .set({ label: title })
                .where(
                  and(
                    eq(chatConversations.id, conversationId),
                    eq(chatConversations.label, conversation.label),
                  ),
                )
                .run();
            }
          })
          .catch(() => {
            // A missing title is cosmetic; the default label stays.
          });
      }
    }
  }

  setConversationStatus(conversationId, status);
  return assistantMsgId;
}

export function runChatTurn(options: RunChatTurnOptions): Response {
  const { projectId, conversationId, strategy } = options;
  const encoder = new TextEncoder();
  const activityId = `chat-${createId()}`;

  let content = "";
  let killed = false;
  let clientCancelled = false;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    strategy.release?.();
  };

  setConversationStatus(conversationId, "generating");

  activityRegistry.register({
    id: activityId,
    projectId,
    type: "chat",
    label: options.activityLabel,
    provider: strategy.provider,
    namedAgentName: options.namedAgentName,
    startedAt: new Date().toISOString(),
    kill: () => {
      killed = true;
      strategy.kill();
    },
  });

  const stream = new ReadableStream({
    async start(controller) {
      // A disconnect closes the controller while the provider is still
      // settling; losing the frame is expected then, losing the durable
      // write that follows is not.
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Client gone.
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          // Already closed by cancel().
        }
      };

      const io: ChatTurnIO = {
        activityId,
        get content() {
          return content;
        },
        emit(event) {
          if (clientCancelled) return;
          if (event.type === "text") {
            content += event.text;
            send({ delta: event.text });
          } else if (event.type === "questions") {
            send({ questions: event.questions });
          } else {
            send({ status: event.status });
          }
        },
      };

      const stoppedQuietly = () => killed && strategy.onKill === "stop";
      let status: "active" | "error";
      try {
        ({ status } = await strategy.run(io));
      } catch (error) {
        if (stoppedQuietly()) {
          status = "active";
        } else {
          const message = strategy.describeFailure(error);
          const delta = content ? `\n\n${message}` : message;
          content += delta;
          send({ delta });
          status = "error";
        }
      }

      release();
      activityRegistry.unregister(activityId);

      if (clientCancelled && !strategy.persistAfterClientCancel) return;
      if (stoppedQuietly()) {
        if (!content) {
          setConversationStatus(conversationId, "active");
          close();
          return;
        }
        status = "active";
      }

      const messageId = storeReply(options, content, status);
      send({ done: true, messageId });
      close();
    },
    cancel() {
      clientCancelled = true;
      killed = true;
      release();
      activityRegistry.unregister(activityId);
      strategy.kill();
      setConversationStatus(conversationId, "active");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
