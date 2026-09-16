import { createChatCliToolChannel } from "@/lib/chat/cli-tool-channel";
import { BundledPiProvider } from "@/lib/providers/bundled-pi";
import type { ProviderSpawnOptions } from "@/lib/providers/types";
import { processOmpEvent } from "./oh-my-pi";
import { isRecord, readProtocolFrame } from "./protocol";
import type { PersistentLifecycle, PersistentProviderAdapter } from "./types";

/**
 * Arij's bundled Pi fork in RPC mode. It speaks the same event protocol as
 * Oh My Pi (see ./oh-my-pi.ts), but is launched through Arij's own Node
 * runtime with a private, 0600 MCP config directory that must be removed on
 * every ending — including a cancel or spawn error before RPC readiness.
 */
export function createPiAdapter(lifecycle: PersistentLifecycle): PersistentProviderAdapter {
  return {
    displayName: "Pi (Arij)",
    binary: process.execPath,
    missingBinaryMessage: "Arij's bundled Pi is unavailable. Reinstall Arij with Node >=22.19.",
    createChannel: (options) =>
      createChatCliToolChannel({
        projectId: options.projectId,
        provider: "pi",
        conversationType: options.conversationType,
      }),
    buildSpawn(options, channel) {
      const provider = new BundledPiProvider();
      const spawnOptions: ProviderSpawnOptions = {
        ...options,
        onChunk: undefined,
        sessionId: options.conversationId,
        mcp: channel?.mcp,
      };
      const context = provider.prepareSpawn(spawnOptions);
      try {
        const args = provider.buildArgs(spawnOptions, context);
        args[args.indexOf("--mode") + 1] = "rpc";
        args.pop(); // RPC accepts prompts as JSON frames, not --print/stdin text.
        return {
          args,
          env: provider.buildEnv(spawnOptions),
          mcpConfigPath: null,
          cleanup: () => provider.cleanupSpawnContext(context),
        };
      } catch (error) {
        provider.cleanupSpawnContext(context);
        throw error;
      }
    },
    encodeTurnFrame: (_persistent, prompt) => {
      const requestId = crypto.randomUUID();
      return {
        requestId,
        frame: `${JSON.stringify({ id: requestId, type: "prompt", message: prompt })}\n`,
      };
    },
    afterTurnRegistered: (persistent, onCliSessionId) => {
      if (persistent.discoveredCliSessionId) onCliSessionId?.(persistent.discoveredCliSessionId);
    },
    attach(persistent, ready) {
      const id = `arij-state-${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        if (ready.settled()) return;
        ready.reject(new Error("Pi RPC initialization timed out"));
        persistent.terminate("initialization timed out");
      }, 45_000);
      timer.unref?.();
      persistent.child.once("spawn", () => {
        persistent.child.stdin?.write(`${JSON.stringify({ id, type: "get_state" })}\n`);
      });
      return {
        dispose: () => clearTimeout(timer),
        handleLine(line) {
          const event = readProtocolFrame(line);
          if (!event) return;
          processOmpEvent(persistent, event, lifecycle);
          if (event.type === "response" && event.id === id) {
            clearTimeout(timer);
            if (event.success && isRecord(event.data) && typeof event.data.sessionId === "string") {
              ready.resolve();
            } else {
              ready.reject(new Error("Pi RPC could not establish its session"));
              persistent.terminate("initialization failed");
            }
          }
          // No custom extension UI is used by Arij. Refuse unexpected dialogs so
          // a settings/package request cannot wedge a warm process indefinitely.
          if (event.type === "extension_ui_request" && typeof event.id === "string") {
            persistent.child.stdin?.write(
              `${JSON.stringify({ type: "extension_ui_response", id: event.id, cancelled: true })}\n`,
            );
          }
        },
      };
    },
  };
}
