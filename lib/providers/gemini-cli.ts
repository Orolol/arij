/**
 * Gemini CLI provider — wraps the `gemini` CLI behind the AgentProvider interface.
 *
 * Spawns `gemini` as a child process (same pattern as Claude Code and Codex).
 */

import { spawnGemini } from "@/lib/gemini/spawn";
import { execSync } from "child_process";
import type {
  AgentProvider,
  ProviderSpawnOptions,
  ProviderSession,
} from "./types";

export class GeminiCliProvider implements AgentProvider {
  readonly type = "gemini-cli" as const;

  spawn(options: ProviderSpawnOptions): ProviderSession {
    const { sessionId, prompt, cwd, mode, model, onChunk, logIdentifier } = options;

    const spawned = spawnGemini({
      mode,
      prompt,
      cwd,
      model,
      logIdentifier,
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
    };
  }

  cancel(session: ProviderSession): boolean {
    session.kill();
    return true;
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
