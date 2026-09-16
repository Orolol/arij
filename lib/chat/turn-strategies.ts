/**
 * The four ways a chat turn reaches a model, as `ChatTurnStrategy`s for
 * `runChatTurn` (lib/chat/turn-runner.ts). Each one only talks to its provider
 * and emits events; the SSE stream, the activity row, the stored reply and
 * the cancel belong to the runner.
 *
 * Every strategy spawns inside `run()`, which the runner calls synchronously
 * while it builds the stream — after the conversation is marked generating
 * and the activity is registered. A spawn that throws is therefore a failed
 * turn shown in the thread, not a 500 that leaves the conversation stuck in
 * "generating".
 *
 * Server-only.
 */
import { parseClaudeOutput } from "@/lib/claude/json-parser";
import { getProvider, type ProviderType } from "@/lib/providers";
import type { NamedAgentCliOptions } from "@/lib/providers/options-registry";
import type { McpSpawnConfig } from "@/lib/providers/types";
import {
  CHAT_BOARD_TOOL_DEFINITIONS,
  executeChatBoardTool,
  type ChatBoardToolContext,
} from "@/lib/chat/board-tools";
import {
  streamOpenAiChatEvents,
  type OpenAiChatMessage,
  type OpenAiConfig,
  type OpenAiToolCall,
} from "@/lib/openai/client";
import { mintMcpToken, revokeMcpTokensForSession } from "@/lib/mcp/token-store";
import { getAppBaseUrl } from "@/lib/webhooks/send";
import {
  restartPersistentChatSession,
  runPersistentChatTurn,
} from "@/lib/chat/persistent-runner";
import type {
  PersistentChatTurnHandle,
  PersistentChatTurnOptions,
} from "@/lib/chat/persistent-providers/types";
import { isResumeSessionExpiredError } from "@/lib/chat/resume-expiry";
import { mintAssignedCliSessionId } from "@/lib/agent-sessions/dispatch-background-session";
import {
  OPENAI_COMPATIBLE_PROVIDER,
  PROVIDER_LABELS,
  type PersistentChatProvider,
} from "@/lib/agent-config/constants";
import { createId } from "@/lib/utils/nanoid";
import type { ChatTurnIO, ChatTurnStrategy } from "@/lib/chat/turn-runner";

/**
 * Upper bound on fast-mode tool rounds per turn (each round is one upstream
 * completion request). Keeps a confused model from looping forever and the
 * messages array from growing without bound.
 */
const MAX_TOOL_ROUNDS = 8;

/**
 * Upper bound on tool calls executed within one round. The overflow still
 * gets a `role:"tool"` reply (the protocol requires one per call id), but
 * an error payload instead of an execution.
 */
const MAX_TOOL_CALLS_PER_ROUND = 8;

function cliFailure(error: unknown): string {
  return error instanceof Error ? `Error: ${error.message}` : "Error: Provider request failed";
}

/** Reply text of a one-shot CLI result, success or not. */
function oneShotReply(result: { success: boolean; result?: string; error?: string }): string {
  return result.success
    ? parseClaudeOutput(result.result || "").content || "(empty response)"
    : `Error: ${result.error || "Provider request failed"}`;
}

/**
 * Whether a first-round upstream failure looks like the endpoint rejecting
 * the `tools` field itself (older OpenAI-compatible servers): client errors
 * only — a generic 500 is usually a transient upstream hiccup, and retrying
 * it without tools would silently strip the board tools for the turn.
 */
function isLikelyToolsRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!error.message.startsWith("OpenAI-compatible API error:")) return false;
  return /\b(400|404|422|501)\b/.test(error.message) || /tool/i.test(error.message);
}

// ---------------------------------------------------------------------------
// OpenAI-compatible fast mode
// ---------------------------------------------------------------------------

export interface FastModeStrategyInput {
  projectId: string;
  config: OpenAiConfig;
  /** System message (when any) + history + the current user message. */
  messages: OpenAiChatMessage[];
  /** Whether board tools are advertised on this turn. */
  toolsEnabled: boolean;
  /**
   * The system content to fall back to when the endpoint rejects `tools`:
   * the section promising tools must go with them, or the model answers
   * board questions from imagination.
   */
  systemPromptWithoutTools: string;
}

/**
 * HTTP streaming against an OpenAI-compatible endpoint, with the multi-round
 * board-tool loop. History travels in the messages array (no session resume).
 * A kill aborts the request and keeps whatever streamed.
 */
export function fastModeStrategy(input: FastModeStrategyInput): ChatTurnStrategy {
  const abortController = new AbortController();
  let toolSessionId: string | null = null;

  return {
    provider: OPENAI_COMPATIBLE_PROVIDER,
    onKill: "stop",
    persistAfterClientCancel: false,
    kill: () => abortController.abort(),
    release: () => {
      if (toolSessionId) revokeMcpTokensForSession(toolSessionId);
    },
    describeFailure: (error) =>
      error instanceof Error && error.message.startsWith("OpenAI-compatible API error:")
        ? error.message
        : `OpenAI-compatible API error: ${
            error instanceof Error ? error.message : "request failed"
          }`,
    async run(io: ChatTurnIO) {
      // Per-turn agent identity for the MCP-backed board tools: status
      // changes land attributed to `agent`, scoped to this project. The fetch
      // base is the app's own constant base URL (never the request's Host
      // header, which a DNS-rebound origin could control and would then
      // receive the bearer token).
      let toolContext: ChatBoardToolContext | null = null;
      if (input.toolsEnabled) {
        toolSessionId = `chat-tools-${io.activityId}`;
        toolContext = {
          projectId: input.projectId,
          baseUrl: getAppBaseUrl(),
          mcpToken: mintMcpToken({
            sessionId: toolSessionId,
            projectId: input.projectId,
            epicId: null,
            userStoryId: null,
            agentType: "chat",
          }),
          signal: abortController.signal,
        };
      }

      const messages = [...input.messages];
      let toolsEnabled = input.toolsEnabled;
      let round = 0;
      while (round < MAX_TOOL_ROUNDS) {
        round += 1;
        let roundText = "";
        let toolCalls: OpenAiToolCall[] = [];
        try {
          for await (const event of streamOpenAiChatEvents(input.config, messages, {
            tools: toolsEnabled ? CHAT_BOARD_TOOL_DEFINITIONS : undefined,
            signal: abortController.signal,
          })) {
            if (event.type === "text") {
              // Separate this round's text from the previous round's.
              const text =
                roundText === "" && io.content.length > 0 ? `\n\n${event.text}` : event.text;
              roundText += event.text;
              io.emit({ type: "text", text });
            } else {
              toolCalls = event.toolCalls;
            }
          }
        } catch (error) {
          if (toolsEnabled && round === 1 && io.content === "" && isLikelyToolsRejection(error)) {
            toolsEnabled = false;
            round = 0;
            if (messages[0]?.role === "system") {
              const noToolsSystemContent = input.systemPromptWithoutTools.trim();
              if (noToolsSystemContent) {
                messages[0] = { role: "system", content: noToolsSystemContent };
              } else {
                messages.shift();
              }
            }
            io.emit({
              type: "status",
              status: "Board tools unavailable on this endpoint — continuing without them.",
            });
            continue;
          }
          throw error;
        }

        if (abortController.signal.aborted) break;
        if (toolCalls.length === 0) break;

        messages.push({ role: "assistant", content: roundText, tool_calls: toolCalls });
        if (round === MAX_TOOL_ROUNDS) {
          io.emit({
            type: "text",
            text: `${io.content ? "\n\n" : ""}[Stopped: tool budget of ${MAX_TOOL_ROUNDS} rounds exhausted.]`,
          });
          break;
        }
        if (!toolContext) {
          // A server emitted tool_calls although none were advertised —
          // treat the round as final rather than execute anything.
          break;
        }
        for (const [callIndex, call] of toolCalls.entries()) {
          // The protocol wants one tool reply per call id; overflow calls get
          // an error payload instead of an execution.
          if (callIndex >= MAX_TOOL_CALLS_PER_ROUND) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({
                error: `Skipped: more than ${MAX_TOOL_CALLS_PER_ROUND} tool calls in one round.`,
              }),
            });
            continue;
          }
          io.emit({ type: "status", status: `Using ${call.function.name}...` });
          const resultJson = await executeChatBoardTool(call, toolContext);
          messages.push({ role: "tool", tool_call_id: call.id, content: resultJson });
        }
      }
      return { status: "active" };
    },
  };
}

// ---------------------------------------------------------------------------
// Warm persistent CLI (claude-code-persistent, oh-my-pi-persistent)
// ---------------------------------------------------------------------------

export interface PersistentStrategyInput
  extends Omit<
    PersistentChatTurnOptions,
    | "provider"
    | "prompt"
    | "cliSessionId"
    | "resumeSession"
    | "onChunk"
    | "onCliSessionId"
    | "idleTimeoutMs"
    | "maxWarmConversations"
    | "turnStallTimeoutMs"
  > {
  provider: PersistentChatProvider;
  /** Full prompt: what a fresh session needs. */
  prompt: string;
  /** What this turn sends: the bare user text when resuming. */
  turnPrompt: string;
  cliSessionId: string | undefined;
  resumeSession: boolean;
  /** The base CLI provider (activity row, fresh-session ids). */
  executionProvider: string;
  /** Read at every launch so a settings change applies to the retry too. */
  limits: () => Pick<
    PersistentChatTurnOptions,
    "idleTimeoutMs" | "maxWarmConversations" | "turnStallTimeoutMs"
  >;
  rememberCliSessionId: (cliSessionId: string) => void;
  forgetCliSessionId: () => void;
}

/**
 * A turn on a long-lived CLI process that streams its output. The partial
 * reply survives a client disconnect.
 */
export function persistentStrategy(input: PersistentStrategyInput): ChatTurnStrategy {
  let currentKill = () => {};
  const label = PROVIDER_LABELS[input.provider];

  return {
    provider: input.executionProvider,
    onKill: "fail",
    persistAfterClientCancel: true,
    kill: () => currentKill(),
    describeFailure: cliFailure,
    async run(io) {
      let sink: ChatTurnIO["emit"] | null = (chunk) => io.emit(chunk);
      const launch = (
        prompt: string,
        cliSessionId: string | undefined,
        resumeSession: boolean,
      ): PersistentChatTurnHandle => {
        const turn = runPersistentChatTurn({
          conversationId: input.conversationId,
          projectId: input.projectId,
          provider: input.provider,
          prompt,
          cwd: input.cwd,
          mode: input.mode,
          model: input.model,
          cliSessionId,
          resumeSession,
          conversationType: input.conversationType,
          ...input.limits(),
          onChunk: (chunk) => sink?.(chunk),
          onCliSessionId: input.rememberCliSessionId,
        });
        currentKill = turn.kill;
        return turn;
      };

      try {
        const turn = launch(input.turnPrompt, input.cliSessionId, input.resumeSession);
        io.emit({
          type: "status",
          status: turn.wasWarm
            ? `${label} session is warm`
            : input.resumeSession
              ? `Restarting and resuming ${label} session...`
              : `Starting ${label} session...`,
        });
        try {
          await turn.promise;
        } catch (error) {
          // Resume-first, like the one-shot paths: the CLI prunes its own
          // session files (Claude Code after `cleanupPeriodDays`), and a
          // stored id that has gone away would otherwise fail every future
          // turn with no in-app way out — "Restart session" only kills the
          // process, it does not forget the dead id. Guarded on empty output
          // so a mid-answer failure cannot splice two replies together.
          const resumeExpired =
            input.resumeSession &&
            !io.content &&
            error instanceof Error &&
            isResumeSessionExpiredError(error.message);
          if (!resumeExpired) throw error;

          restartPersistentChatSession(input.conversationId);
          input.forgetCliSessionId();
          io.emit({
            type: "status",
            status: `Stored ${label} session expired; starting a fresh one...`,
          });
          // A fresh session has no history, so it needs the full prompt
          // rather than the resume path's bare user message.
          await launch(input.prompt, mintAssignedCliSessionId(input.executionProvider), false)
            .promise;
        }
        return { status: "active" };
      } finally {
        sink = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CLI providers through their adapter: one-shot, or streamed when they can
// ---------------------------------------------------------------------------

interface CliStrategyInputBase {
  /** Full prompt: what a fresh session needs. */
  prompt: string;
  /** What this turn sends: the bare user text when resuming. */
  turnPrompt: string;
  cwd: string | undefined;
  model: string | undefined;
  cliOptions: NamedAgentCliOptions | undefined;
  toolChannel: { mcp: McpSpawnConfig; release: () => void } | null;
  cliSessionId: string | undefined;
  rememberCliSessionId: (cliSessionId: string | undefined) => void;
}

export interface ProviderStrategyInput extends CliStrategyInputBase {
  provider: ProviderType;
  cwd: string;
  /** "plan" for prompt-contract conversations, "chat" otherwise. */
  mode: "plan" | "chat";
  resumeSession: boolean;
}

/**
 * Whether the provider has an incremental chat stream. Never throws: an
 * adapter lookup that fails is left to the strategy's run(), where the
 * runner turns it into a failed turn and still releases the tool channel.
 */
export function providerCanStream(provider: ProviderType): boolean {
  try {
    return typeof getProvider(provider).spawnStream === "function";
  } catch {
    return false;
  }
}

/**
 * A CLI provider run to completion through its adapter (no token
 * streaming): every resume, and any provider without `spawnStream`. An
 * expired resume session is retried once, fresh.
 */
export function providerStrategy(input: ProviderStrategyInput): ChatTurnStrategy {
  let currentKill = () => {};

  const spawn = (prompt: string, cliSessionId: string | undefined, resumeSession: boolean) => {
    // Looked up here, inside run(), not when the strategy is built: the route
    // has already minted the tool channel's MCP token by then, and an adapter
    // lookup that throws outside run() would skip the runner's release.
    const session = getProvider(input.provider).spawn({
      sessionId: `chat-${createId()}`,
      prompt,
      cwd: input.cwd,
      mode: input.mode,
      model: input.model,
      cliSessionId,
      resumeSession,
      mcp: input.toolChannel?.mcp,
      // A chat turn has no agent_sessions row, so it never reaches
      // processManager.start() — the agent's CLI options are carried here,
      // the same way the tool channel carries the MCP channel. The retry
      // below carries them too: a fresh session is still that agent.
      cliOptions: input.cliOptions,
    });
    currentKill = session.kill;
    return session;
  };

  return {
    provider: input.provider,
    onKill: "fail",
    persistAfterClientCancel: false,
    kill: () => currentKill(),
    release: () => input.toolChannel?.release(),
    describeFailure: cliFailure,
    async run(io) {
      io.emit({ type: "status", status: `${PROVIDER_LABELS[input.provider]} processing...` });
      let cliSessionId = input.cliSessionId;
      let result = await spawn(input.turnPrompt, cliSessionId, input.resumeSession).promise;

      if (input.resumeSession && !result.success && isResumeSessionExpiredError(result.error)) {
        cliSessionId = mintAssignedCliSessionId(input.provider);
        result = await spawn(input.prompt, cliSessionId, false).promise;
      }

      if (result.success) input.rememberCliSessionId(result.cliSessionId ?? cliSessionId);
      io.emit({ type: "text", text: oneShotReply(result) });
      return { status: result.success ? "active" : "error" };
    },
  };
}

/**
 * A fresh session on a provider with an incremental chat stream (Claude
 * Code's stream-json), relayed token by token. The partial reply survives a
 * client disconnect.
 */
export function providerStreamStrategy(input: ProviderStrategyInput): ChatTurnStrategy {
  let currentKill = () => {};

  return {
    provider: input.provider,
    onKill: "fail",
    persistAfterClientCancel: true,
    kill: () => currentKill(),
    release: () => input.toolChannel?.release(),
    describeFailure: cliFailure,
    async run(io) {
      const adapter = getProvider(input.provider);
      if (!adapter.spawnStream) {
        throw new Error(`${PROVIDER_LABELS[input.provider]} cannot stream a chat turn`);
      }
      const { stream, kill } = adapter.spawnStream({
        sessionId: `chat-${createId()}`,
        mode: input.mode,
        prompt: input.turnPrompt,
        model: input.model,
        cwd: input.cwd,
        cliSessionId: input.cliSessionId,
        mcp: input.toolChannel?.mcp,
        cliOptions: input.cliOptions,
      });
      currentKill = kill;

      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          io.emit(value);
        }
      } catch (err) {
        // The reply keeps what streamed; the conversation shows the error
        // state rather than a failure line spliced into a partial answer.
        console.error("[chat/stream] Stream error:", err);
        return { status: "error" };
      }

      input.rememberCliSessionId(input.cliSessionId);
      return { status: "active" };
    },
  };
}
