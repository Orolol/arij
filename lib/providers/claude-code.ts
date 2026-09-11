/**
 * Claude Code provider — the `claude` CLI behind the AgentProvider interface.
 *
 * The argv construction and the process lifecycle stay in lib/claude/spawn.ts
 * (--permission-mode, --allowedTools, the 0600 `--mcp-config` file, the
 * stream-json variant used by the chat SSE route). This class is the ONLY
 * caller of spawnClaude outside that module: every one-shot session — the
 * process manager, the routes that spawn directly (chat, spec generation, QA
 * epic extraction, import, titling) — goes through `getProvider(provider)
 * .spawn(...)` regardless of provider, so there is no `provider !==
 * "claude-code"` branch left to copy from one call site to the next.
 *
 * Streaming: when the caller passes `onChunk`, the spawn runs in stream-json
 * mode and every NDJSON event line becomes a `raw` chunk as it arrives — the
 * LIVE LOG band of a claude-code session used to stay empty for its whole
 * duration because json mode yields nothing before exit. The final text is
 * emitted as the `output`/`response` chunks the other providers emit, with
 * the same keys, so the process manager persists nothing itself.
 */

import { spawnClaude } from "@/lib/claude/spawn";
import { parseClaudeOutput, isNoTextualOutputFallback } from "@/lib/claude/json-parser";
import { BaseCliProvider } from "./base-provider";
import type {
  ProviderSpawnOptions,
  ProviderSession,
  ProviderResult,
} from "./types";

export class ClaudeCodeProvider extends BaseCliProvider {
  readonly type = "claude-code" as const;

  get binaryName(): string {
    return "claude";
  }

  buildArgs(_options: ProviderSpawnOptions): string[] {
    // Not used — Claude Code overrides spawn() entirely
    return [];
  }

  extractResult(stdout: string): string {
    // Not used — Claude Code overrides spawn() entirely
    return stdout.trim();
  }

  /**
   * Delegates to spawnClaude(), which owns Claude Code's argv and streaming.
   * Everything the process manager needs back — the kill, the display
   * command, the temp `--mcp-config` path it tears down on its own exit
   * path — rides on the returned session.
   */
  spawn(options: ProviderSpawnOptions): ProviderSession {
    const {
      prompt,
      cwd,
      mode,
      allowedTools,
      model,
      cliSessionId,
      resumeSession,
      logIdentifier,
      mcp,
      cliOptions,
      killGraceMs,
      onChunk,
    } = options;

    let rawIndex = 0;
    const { promise: rawPromise, kill, command, mcpConfigPath } = spawnClaude({
      mode,
      prompt,
      cwd,
      allowedTools,
      model,
      cliSessionId,
      resumeSession,
      logIdentifier,
      mcp,
      cliOptions,
      killGraceMs,
      ...(onChunk
        ? {
            onRawLine: (line: string) => {
              rawIndex += 1;
              onChunk({
                streamType: "raw",
                text: `${line}\n`,
                chunkKey: `stdout:${rawIndex}`,
                emittedAt: new Date().toISOString(),
              });
            },
          }
        : {}),
    });

    // Map ClaudeResult → ProviderResult, and emit the final chunks the way
    // BaseCliProvider.emitFinalChunks does for the other CLIs.
    const promise: Promise<ProviderResult> = rawPromise.then((r) => {
      if (onChunk && r.result) {
        try {
          const text = parseClaudeOutput(r.result).content;
          if (text && !isNoTextualOutputFallback(text)) {
            const emittedAt = new Date().toISOString();
            onChunk({ streamType: "output", text, chunkKey: "final-output", emittedAt });
            onChunk({ streamType: "response", text, chunkKey: "final-response", emittedAt });
          }
        } catch {
          // A listener must never turn a finished run into a failed one.
        }
      }
      return {
        success: r.success,
        result: r.result,
        error: r.error,
        duration: r.duration,
        cliSessionId: r.cliSessionId,
        endedWithQuestion: r.endedWithQuestion,
      };
    });

    return {
      handle: `cc-${options.sessionId}`,
      kill,
      promise,
      command,
      mcpConfigPath,
    };
  }
}
