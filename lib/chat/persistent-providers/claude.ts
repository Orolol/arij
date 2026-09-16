import { writeMcpConfigFile } from "@/lib/claude/mcp-injection";
import type { QuestionData } from "@/lib/claude/spawn";
import { createChatCliToolChannel } from "@/lib/chat/cli-tool-channel";
import { readProtocolFrame } from "./protocol";
import type {
  PersistentChatTurnOptions,
  PersistentLifecycle,
  PersistentProcess,
  PersistentProviderAdapter,
} from "./types";

function claudeInputMessage(prompt: string): string {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
    parent_tool_use_id: null,
  })}\n`;
}

function claudeArgs(
  options: PersistentChatTurnOptions,
  mcpConfigPath: string | null,
  allowedToolNames: string[],
): string[] {
  const permissionMode = options.mode === "plan" ? "plan" : "default";
  const allowedTools = options.mode === "chat" ? ["Read", "Glob", "Grep"] : [];
  const args = [
    "--permission-mode",
    permissionMode,
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];

  if (options.cliSessionId && options.resumeSession) {
    args.push("--resume", options.cliSessionId);
  } else if (options.cliSessionId) {
    args.push("--session-id", options.cliSessionId);
  }
  if (options.model) args.push("--model", options.model);
  if (mcpConfigPath && options.provider === "claude-code-persistent") {
    args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
  }

  if (allowedTools.length > 0 || allowedToolNames.length > 0) {
    args.push("--allowedTools", ...allowedTools, ...allowedToolNames);
  }
  return args;
}

function eventText(event: Record<string, unknown>): string | null {
  const nested =
    event.type === "stream_event" && event.event && typeof event.event === "object"
      ? (event.event as Record<string, unknown>)
      : event;
  if (nested.type !== "content_block_delta") return null;
  const delta = nested.delta;
  if (!delta || typeof delta !== "object") return null;
  const typed = delta as { type?: unknown; text?: unknown };
  return typed.type === "text_delta" && typeof typed.text === "string"
    ? typed.text
    : null;
}

function eventQuestions(event: Record<string, unknown>): QuestionData[] | null {
  if (event.type !== "assistant") return null;
  const message = event.message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as {
      type?: unknown;
      name?: unknown;
      input?: { questions?: unknown };
    };
    if (
      typed.type === "tool_use" &&
      typed.name === "AskUserQuestion" &&
      Array.isArray(typed.input?.questions)
    ) {
      return typed.input.questions as QuestionData[];
    }
  }
  return null;
}

function resultFallbackText(event: Record<string, unknown>): string {
  return typeof event.result === "string" ? event.result : "";
}

function resultError(event: Record<string, unknown>): string | null {
  if (event.type !== "result") return null;
  if (event.is_error !== true && event.subtype !== "error_during_execution") {
    return null;
  }
  if (Array.isArray(event.errors)) {
    const joined = event.errors.filter((item) => typeof item === "string").join("; ");
    if (joined) return joined;
  }
  return resultFallbackText(event) || "Claude Code turn failed";
}

function processClaudeEvent(
  process: PersistentProcess,
  raw: string,
  lifecycle: PersistentLifecycle,
): void {
  const event = readProtocolFrame(raw);
  if (!event) return;

  const sessionId =
    typeof event.session_id === "string" ? event.session_id : undefined;
  if (sessionId) {
    process.discoveredCliSessionId = sessionId;
    process.activeTurn?.onCliSessionId?.(sessionId);
  }

  const turn = process.activeTurn;
  if (!turn) return;
  lifecycle.noteTurnProgress(process);

  const text = eventText(event);
  if (text) {
    turn.textDeltasEmitted = true;
    turn.onChunk({ type: "text", text });
    return;
  }

  const questions = eventQuestions(event);
  if (questions) {
    turn.onChunk({ type: "questions", questions });
    return;
  }

  const nested =
    event.type === "stream_event" && event.event && typeof event.event === "object"
      ? (event.event as Record<string, unknown>)
      : event;
  if (nested.type === "content_block_start") {
    const contentBlock = nested.content_block;
    if (contentBlock && typeof contentBlock === "object") {
      const block = contentBlock as { type?: unknown; name?: unknown };
      if (block.type === "tool_use") {
        turn.onChunk({
          type: "status",
          status: `Using ${typeof block.name === "string" ? block.name : "tool"}...`,
        });
      } else if (block.type === "thinking") {
        turn.onChunk({ type: "status", status: "Thinking..." });
      }
    }
  }

  if (event.type !== "result") return;
  const error = resultError(event);
  if (error) {
    lifecycle.finishTurn(process, new Error(error));
    return;
  }
  if (!turn.textDeltasEmitted) {
    const fallback = resultFallbackText(event);
    if (fallback) turn.onChunk({ type: "text", text: fallback });
  }
  lifecycle.finishTurn(process);
}

export function createClaudeAdapter(lifecycle: PersistentLifecycle): PersistentProviderAdapter {
  return {
    displayName: "Claude Code",
    binary: "claude",
    missingBinaryMessage:
      "Claude CLI not found. Ensure `claude` is installed and available in PATH.",
    createChannel: (options) =>
      createChatCliToolChannel({
        projectId: options.projectId,
        provider: "claude-code",
        conversationType: options.conversationType,
      }),
    buildSpawn(options, channel) {
      let mcpConfigPath: string | null = null;
      let allowedToolNames: string[] = [];
      if (channel) {
        allowedToolNames = channel.mcp.allowedToolNames;
        try {
          mcpConfigPath = writeMcpConfigFile(channel.mcp);
        } catch (error) {
          allowedToolNames = [];
          console.warn(
            "[persistent-chat] MCP config write failed; continuing without board tools:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      return {
        args: claudeArgs(options, mcpConfigPath, allowedToolNames),
        env: { ...process.env },
        mcpConfigPath,
      };
    },
    encodeTurnFrame: (_process, prompt) => ({ frame: claudeInputMessage(prompt) }),
    attach(persistent, ready) {
      persistent.child.once("spawn", () => ready.resolve());
      return {
        handleLine: (line) => processClaudeEvent(persistent, line, lifecycle),
        dispose: () => {},
      };
    },
  };
}
