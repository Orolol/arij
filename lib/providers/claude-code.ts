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
 * What the class cannot do yet: stream. spawnClaude runs `--output-format
 * json`, which yields one document on exit, so `onChunk` is accepted and
 * ignored — the LIVE LOG band stays empty for claude-code sessions until the
 * spawn moves to stream-json (session storage lot).
 */

import { spawnClaude } from "@/lib/claude/spawn";
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
    } = options;

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
    });

    // Map ClaudeResult → ProviderResult
    const promise: Promise<ProviderResult> = rawPromise.then((r) => ({
      success: r.success,
      result: r.result,
      error: r.error,
      duration: r.duration,
      cliSessionId: r.cliSessionId,
      endedWithQuestion: r.endedWithQuestion,
    }));

    return {
      handle: `cc-${options.sessionId}`,
      kill,
      promise,
      command,
      mcpConfigPath,
    };
  }
}
