/**
 * DeepSeek provider — wraps the `deepseek` CLI.
 *
 * CLI: deepseek -q <PROMPT> [--model <model>] [--no-stream]
 *
 * Mode mapping: all modes use -q (query mode). No permission system.
 * Resume: not supported (SQLite history is local to CLI).
 * Output: raw text with --no-stream for complete capture.
 * --no-stream is mandatory for headless to avoid partial chunk handling.
 */

import { BaseCliProvider } from "./base-provider";
import type { ProviderSpawnOptions } from "./types";

export class DeepSeekProvider extends BaseCliProvider {
  readonly type = "deepseek" as const;

  get binaryName(): string {
    return "deepseek";
  }

  buildArgs(options: ProviderSpawnOptions): string[] {
    const { prompt, model } = options;

    const args: string[] = ["-q", prompt];

    // Always use --no-stream for reliable headless output capture
    args.push("--no-stream");

    if (model) {
      args.push("--model", model);
    }

    return args;
  }

  extractResult(stdout: string): string {
    return stdout.trim();
  }

  /**
   * DeepSeek does not support resume.
   * Always return undefined to prevent resume attempts.
   */
  parseSessionId(): string | undefined {
    return undefined;
  }
}
