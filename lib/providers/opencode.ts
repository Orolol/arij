/**
 * OpenCode provider — wraps the `opencode` CLI.
 *
 * CLI: opencode run <PROMPT> [--format json] [--session <ID>] [--file <path>]
 *
 * Mode mapping: all modes use `run` subcommand (OpenCode handles permissions internally).
 * Resume: supported via --session <ID>.
 * Output: JSON events format.
 */

import { BaseCliProvider } from "./base-provider";
import type { ProviderSpawnOptions } from "./types";

export class OpenCodeProvider extends BaseCliProvider {
  readonly type = "opencode" as const;

  get binaryName(): string {
    return "opencode";
  }

  buildArgs(options: ProviderSpawnOptions): string[] {
    const { prompt, model, cliSessionId, claudeSessionId, resumeSession } = options;
    const sessionId = cliSessionId ?? claudeSessionId;

    const args: string[] = ["run", prompt];

    args.push("--format", "json");

    // Resume support
    if (sessionId && resumeSession) {
      args.push("--session", sessionId);
    }

    if (model) {
      args.push("--model", model);
    }

    return args;
  }

  extractResult(stdout: string): string {
    const trimmed = stdout.trim();
    if (!trimmed) return "";

    // Try JSON output parsing
    const parts: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (!l.startsWith("{")) continue;
      try {
        const event = JSON.parse(l);
        // OpenCode event format: text content is nested in event.part.text
        const part = event.part;
        if (part && typeof part === "object" && typeof part.text === "string") {
          parts.push(part.text);
        } else if (typeof event.text === "string") {
          parts.push(event.text);
        } else if (typeof event.content === "string") {
          parts.push(event.content);
        } else if (typeof event.result === "string") {
          parts.push(event.result);
        } else if (typeof event.output === "string") {
          parts.push(event.output);
        }
      } catch {
        // skip
      }
    }

    return parts.length > 0 ? parts.join("") : trimmed;
  }

  buildDisplayCommand(args: string[], prompt: string): string {
    const displayArgs = args.map((a) => {
      if (a === prompt && a.length > 50) return "<prompt>";
      return a;
    });
    return `opencode ${displayArgs.join(" ")}`;
  }
}
