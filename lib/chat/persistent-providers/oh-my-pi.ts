import { createChatCliToolChannel } from "@/lib/chat/cli-tool-channel";
import { buildOmpSpawnEnv, OMP_READONLY_TOOLS } from "@/lib/providers/oh-my-pi";
import { ompRestrictedToolsBlockReason } from "@/lib/providers/omp-version";
import { isRecord, readProtocolFrame } from "./protocol";
import type {
  ActiveTurn,
  PersistentChatTurnOptions,
  PersistentLifecycle,
  PersistentProcess,
  PersistentProviderAdapter,
} from "./types";

function readOmpTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * The error a turn should fail with, if any. A spent retry ladder outranks the
 * last message's own error: its `finalError` is the summary OMP chose to
 * report, and by then the message error is one symptom among several.
 */
function pendingOmpError(turn: ActiveTurn): string | undefined {
  return turn.retryError ?? turn.messageError;
}

function processOmpEvent(
  process: PersistentProcess,
  event: Record<string, unknown>,
  lifecycle: PersistentLifecycle,
): void {

  if (event.type === "response" && event.command === "get_state") {
    const data = event.data;
    if (isRecord(data) && typeof data.sessionId === "string") {
      process.discoveredCliSessionId = data.sessionId;
      process.activeTurn?.onCliSessionId?.(data.sessionId);
    }
    return;
  }

  const turn = process.activeTurn;
  if (!turn) return;
  lifecycle.noteTurnProgress(process);

  if (
    event.type === "response" &&
    event.command === "prompt" &&
    (!event.id || event.id === turn.requestId)
  ) {
    if (event.success === false) {
      lifecycle.finishTurn(
        process,
        new Error(
          typeof event.error === "string"
            ? event.error
            : "Oh My Pi rejected the prompt",
        ),
      );
      return;
    }
    // Acceptance is not completion: the run normally ends on `agent_end`.
    // The one exception is a prompt OMP handled locally (a slash command that
    // never starts an agent turn), which reports `agentInvoked: false` here or
    // in a later `prompt_result` and emits no agent lifecycle events at all.
    if (isRecord(event.data) && event.data.agentInvoked === false) {
      finishLocalOnlyOmpTurn(process, turn, lifecycle);
    }
    return;
  }

  if (
    event.type === "prompt_result" &&
    event.agentInvoked === false &&
    (!event.id || event.id === turn.requestId)
  ) {
    finishLocalOnlyOmpTurn(process, turn, lifecycle);
    return;
  }

  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (!isRecord(update)) return;
    if (update.type === "text_delta" && typeof update.delta === "string") {
      turn.textDeltasEmitted = true;
      turn.onChunk({ type: "text", text: update.delta });
    } else if (update.type === "thinking_start") {
      turn.onChunk({ type: "status", status: "Thinking..." });
    }
    return;
  }

  if (event.type === "tool_execution_start") {
    turn.onChunk({
      type: "status",
      status: `Using ${typeof event.toolName === "string" ? event.toolName : "tool"}...`,
    });
    return;
  }

  if (event.type === "auto_retry_end") {
    if (event.success === false) {
      turn.retryError =
        typeof event.finalError === "string"
          ? event.finalError
          : "Oh My Pi exhausted its automatic retries.";
      return;
    }
    // OMP emits this only from its `status: "recovered"` path, i.e. after a
    // retry actually rescued the turn. Whatever the failed attempts left
    // behind is now stale and must not reach the user.
    turn.retryError = undefined;
    turn.messageError = undefined;
    return;
  }

  if (event.type === "message_end" && isRecord(event.message)) {
    const message = event.message;
    if (message.role !== "assistant") return;
    turn.fallbackText = readOmpTextBlocks(message.content);
    // Overwrite, never accumulate: a retried turn settles once per attempt,
    // and only the last settle describes what the user actually got.
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      turn.messageError =
        typeof message.errorMessage === "string"
          ? message.errorMessage
          : message.stopReason === "aborted"
            ? "Oh My Pi run was aborted."
            : "Oh My Pi run ended with an error.";
    } else {
      turn.messageError = undefined;
    }
    return;
  }

  // End of run. OMP's own RPC reference is explicit: "agent turns complete
  // only on `agent_end` frames where `isTerminal !== false`". A non-terminal
  // `agent_end` means maintenance or async delivery scheduled more work and
  // the session will resume, so it must not close the turn. `willContinue` is
  // the pre-mapping spelling of the same fact on some frames; treat either as
  // "more is coming".
  if (event.type !== "agent_end") return;
  if (event.isTerminal === false || event.willContinue === true) return;
  const failure = pendingOmpError(turn);
  if (failure) {
    lifecycle.finishTurn(process, new Error(failure));
    return;
  }
  if (!turn.textDeltasEmitted && turn.fallbackText) {
    turn.onChunk({ type: "text", text: turn.fallbackText });
  }
  lifecycle.finishTurn(process);
}

/**
 * Completes a turn OMP resolved without invoking the agent. No assistant
 * message exists in that case, so the accumulated `message_end` text (if any)
 * is the only thing worth flushing.
 */
function finishLocalOnlyOmpTurn(
  process: PersistentProcess,
  turn: ActiveTurn,
  lifecycle: PersistentLifecycle,
): void {
  const failure = pendingOmpError(turn);
  if (failure) {
    lifecycle.finishTurn(process, new Error(failure));
    return;
  }
  if (!turn.textDeltasEmitted && turn.fallbackText) {
    turn.onChunk({ type: "text", text: turn.fallbackText });
  }
  lifecycle.finishTurn(process);
}

function ompArgs(options: PersistentChatTurnOptions): string[] {
  // No `--config`: the xdev-off overlay this used to carry is measurably a
  // no-op on omp 18.0.6, and the flag can displace the user's whole
  // ~/.omp/agent/config.yml — see lib/providers/oh-my-pi.ts. The allowlist
  // below is therefore the whole isolation mechanism, which is what the
  // adapter's `preflight` version floor protects.
  const args = [
    "--mode",
    "rpc",
    "--tools",
    OMP_READONLY_TOOLS.join(","),
    "--no-title",
  ];
  if (options.cliSessionId && options.resumeSession) {
    args.push("--resume", options.cliSessionId);
  }
  if (options.model) args.push("--model", options.model);
  return args;
}

export function createOmpAdapter(lifecycle: PersistentLifecycle): PersistentProviderAdapter {
  return {
    displayName: "Oh My Pi",
    binary: "omp",
    missingBinaryMessage:
      "Oh My Pi CLI not found. Ensure `omp` is installed and available in PATH.",
    // Persistent chat is always tool-restricted (see ompArgs), so the allowlist
    // is its whole isolation mechanism and the version floor always applies.
    preflight: ompRestrictedToolsBlockReason,
    createChannel: (options) =>
      createChatCliToolChannel({
        projectId: options.projectId,
        provider: "oh-my-pi",
        conversationType: options.conversationType,
      }),
    buildSpawn: (options, channel) => ({
      args: ompArgs(options),
      env: buildOmpSpawnEnv(process.env, channel?.mcp),
      mcpConfigPath: null,
    }),
    encodeTurnFrame(persistent, prompt) {
      const requestId = crypto.randomUUID();
      const frame = `${JSON.stringify({
        id: requestId,
        type: "prompt",
        message: prompt,
      })}\n`;
      if (persistent.maxFrameBytes && Buffer.byteLength(frame) > persistent.maxFrameBytes) {
        throw new Error(
          `Oh My Pi RPC prompt exceeds the ${persistent.maxFrameBytes}-byte frame limit`,
        );
      }
      return { frame, requestId };
    },
    afterTurnRegistered(persistent, onCliSessionId) {
      // A resumed process already knows its session id, so report it without
      // waiting for the `get_state` round trip.
      if (persistent.discoveredCliSessionId) {
        onCliSessionId?.(persistent.discoveredCliSessionId);
      }
    },
    attach(persistent, ready, options) {
      let protocolReady = false;
      const handshakeTimer = setTimeout(() => {
        if (protocolReady) return;
        const error = new Error("Oh My Pi RPC handshake timed out");
        ready.reject(error);
        lifecycle.cleanupProcess(persistent, error);
        persistent.terminate("RPC handshake timed out");
      }, 10_000);
      handshakeTimer.unref?.();

      return {
        dispose: () => clearTimeout(handshakeTimer),
        handleLine(line) {
          const event = readProtocolFrame(line);
          if (!event) return;
          if (event.type !== "ready") {
            processOmpEvent(persistent, event, lifecycle);
            return;
          }
          const versions = Array.isArray(event.supportedProtocolVersions)
            ? event.supportedProtocolVersions
            : [event.protocolVersion];
          if (!versions.includes(1)) {
            const error = new Error("Oh My Pi RPC protocol 1 is not supported");
            ready.reject(error);
            lifecycle.cleanupProcess(persistent, error);
            persistent.terminate("unsupported RPC protocol");
            return;
          }
          protocolReady = true;
          clearTimeout(handshakeTimer);
          persistent.maxFrameBytes =
            typeof event.maxFrameBytes === "number" ? event.maxFrameBytes : 1_048_576;
          persistent.child.stdin?.write(
            `${JSON.stringify({
              id: `arij-state-${options.conversationId}`,
              type: "get_state",
            })}\n`,
          );
          ready.resolve();
        },
      };
    },
  };
}
