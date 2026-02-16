/**
 * Gemini CLI provider — wraps the `gemini` CLI behind the AgentProvider interface.
 *
 * Gemini has custom JSON/stream output parsing and error detection,
 * so it overrides spawn() to delegate to spawnGemini().
 */

import { execSync } from "child_process";
import { spawnGemini } from "@/lib/gemini/spawn";
import { BaseCliProvider } from "./base-provider";
import type {
  ProviderSession,
  ProviderSpawnOptions,
} from "./types";

export class GeminiCliProvider extends BaseCliProvider {
  readonly type = "gemini-cli" as const;

  get binaryName(): string {
    return "gemini";
  }

  buildArgs(_options: ProviderSpawnOptions): string[] {
    // Not used — Gemini overrides spawn() entirely
    return [];
  }

  extractResult(stdout: string): string {
    // Not used — Gemini overrides spawn() entirely
    return stdout.trim();
  }

  /**
   * Override spawn to delegate to spawnGemini() which handles
   * Gemini's custom JSON/Vertex output parsing.
   */
  spawn(options: ProviderSpawnOptions): ProviderSession {
    const {
      sessionId,
      mode,
      prompt,
      cwd,
      model,
      onChunk,
      logIdentifier,
      cliSessionId,
      claudeSessionId,
      resumeSession,
    } = options;

    const spawned = spawnGemini({
      mode,
      prompt,
      cwd,
      model,
      logIdentifier,
      sessionId: cliSessionId ?? claudeSessionId,
      resumeSession,
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
      handle: `gemini-${sessionId}`,
      kill: spawned.kill,
      promise: spawned.promise,
      command: spawned.command,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which gemini", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}
