/**
 * Kimi (Moonshot) provider — wraps the `kimi` CLI.
 *
 * CLI: kimi --print -c <PROMPT>
 *
 * Mode mapping: all modes use --print (headless mode).
 * Resume: supported via --continue (resumes most recent context in current directory).
 * Output: stream-json format.
 */

import { BaseCliProvider } from "./base-provider";
import type { ProviderSpawnOptions } from "./types";

export class KimiProvider extends BaseCliProvider {
  readonly type = "kimi" as const;

  get binaryName(): string {
    return "kimi";
  }

  buildArgs(options: ProviderSpawnOptions): string[] {
    const { prompt, resumeSession } = options;

    const args: string[] = ["--print"];

    // Resume: --continue resumes most recent context in the current directory
    if (resumeSession) {
      args.push("--continue");
    }

    args.push("-c", prompt);

    return args;
  }

  extractResult(stdout: string): string {
    const trimmed = stdout.trim();
    if (!trimmed) return "";

    // Try stream-json parsing
    const parts: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (!l.startsWith("{")) continue;
      try {
        const event = JSON.parse(l);
        if (typeof event.text === "string") parts.push(event.text);
        else if (typeof event.content === "string") parts.push(event.content);
        else if (typeof event.result === "string") parts.push(event.result);
        else if (event.type === "content_block_delta" && typeof event.delta?.text === "string") {
          parts.push(event.delta.text);
        }
      } catch {
        // skip
      }
    }

    return parts.length > 0 ? parts.join("") : trimmed;
  }

  /**
   * Kimi resume is directory-scoped (--continue). We don't extract a session ID
   * from output; instead the presence of a previous session in the same cwd
   * enables resume. Return the fallback ID if provided.
   */
  parseSessionId(
    _stdout: string,
    _stderr: string,
    fallbackId?: string,
  ): string | undefined {
    return fallbackId;
  }
}
