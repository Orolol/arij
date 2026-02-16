/**
 * Codex provider — wraps the `codex` CLI behind the AgentProvider interface.
 *
 * Codex uses `codex exec` with a temp-file output capture (-o) and has
 * a distinct resume subcommand (`codex exec resume <ID>`), so it
 * overrides spawn() to delegate to spawnCodex() rather than using
 * BaseCliProvider's generic spawn logic.
 */

import { spawnCodex } from "@/lib/codex/spawn";
import { CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS } from "@/lib/codex/constants";
import { execSync } from "child_process";
import { BaseCliProvider } from "./base-provider";
import type {
  ProviderSpawnOptions,
  ProviderSession,
} from "./types";

export class CodexProvider extends BaseCliProvider {
  readonly type = "codex" as const;

  get binaryName(): string {
    return "codex";
  }

  buildArgs(_options: ProviderSpawnOptions): string[] {
    // Not used — Codex overrides spawn() entirely
    return [];
  }

  extractResult(stdout: string): string {
    // Not used — Codex overrides spawn() entirely
    return stdout.trim();
  }

  /**
   * Override spawn to delegate to spawnCodex() which handles
   * temp-file output capture and the resume subcommand.
   */
  spawn(options: ProviderSpawnOptions): ProviderSession {
    const { sessionId, prompt, cwd, mode, model, onChunk, logIdentifier, cliSessionId, resumeSession } =
      options;

    const spawned = spawnCodex({
      mode,
      prompt,
      cwd,
      model,
      logIdentifier,
      cliSessionId,
      resumeSession,
      developerInstructions: CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS,
      onRawChunk: ({ source, index, text, emittedAt }) =>
        onChunk?.({
          streamType: "raw",
          text,
          chunkKey: `${source}:${index}`,
          emittedAt,
        }),
      onOutputChunk: ({ text, emittedAt }) =>
        onChunk?.({
          streamType: "output",
          text,
          chunkKey: "final-output",
          emittedAt,
        }),
      onResponseChunk: ({ text, emittedAt }) =>
        onChunk?.({
          streamType: "response",
          text,
          chunkKey: "final-response",
          emittedAt,
        }),
    });

    return {
      handle: `codex-${sessionId}`,
      kill: spawned.kill,
      promise: spawned.promise,
      command: spawned.command,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which codex", { stdio: "ignore" });
    } catch {
      return false;
    }
    // Also check login status (codex writes to stderr)
    try {
      const output = execSync("codex login status 2>&1", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return /logged in/i.test(output);
    } catch {
      return false;
    }
  }
}
