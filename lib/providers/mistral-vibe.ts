/**
 * Mistral Vibe provider — wraps the `vibe` CLI (Devstral models).
 *
 * CLI: vibe --prompt <PROMPT> --agent <profile> --output json [--model <m>] [--resume <ID>] [--max-turns 50]
 *
 * Mode mapping:
 * - plan  → --agent plan
 * - code  → --agent auto-approve
 * - analyze → --agent accept-edits
 *
 * Resume: supported via --resume <ID>.
 * Output: JSON with full conversation and metadata.
 */

import { BaseCliProvider } from "./base-provider";
import type { ProviderSpawnOptions } from "./types";

const MODE_TO_AGENT: Record<string, string> = {
  plan: "plan",
  code: "auto-approve",
  analyze: "accept-edits",
};

export class MistralVibeProvider extends BaseCliProvider {
  readonly type = "mistral-vibe" as const;

  get binaryName(): string {
    return "vibe";
  }

  buildArgs(options: ProviderSpawnOptions): string[] {
    const { prompt, mode, model, cliSessionId, claudeSessionId, resumeSession } = options;
    const sessionId = cliSessionId ?? claudeSessionId;

    const args: string[] = [];

    // Resume support
    if (sessionId && resumeSession) {
      args.push("--resume", sessionId);
    }

    args.push("--prompt", prompt);
    args.push("--agent", MODE_TO_AGENT[mode] ?? "auto-approve");
    args.push("--output", "json");

    if (model) {
      args.push("--model", model);
    }

    // Prevent infinite loops
    args.push("--max-turns", "50");

    return args;
  }

  extractResult(stdout: string): string {
    const trimmed = stdout.trim();
    if (!trimmed) return "";

    // Try to parse JSON output and extract text content
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.result === "string") return parsed.result;
      if (typeof parsed.output === "string") return parsed.output;
      if (typeof parsed.content === "string") return parsed.content;
      if (typeof parsed.text === "string") return parsed.text;
    } catch {
      // Fall through to line-by-line parsing
    }

    // Try NDJSON lines
    const parts: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (!l.startsWith("{")) continue;
      try {
        const event = JSON.parse(l);
        if (typeof event.text === "string") parts.push(event.text);
        else if (typeof event.content === "string") parts.push(event.content);
        else if (typeof event.result === "string") parts.push(event.result);
      } catch {
        // skip
      }
    }

    return parts.length > 0 ? parts.join("") : trimmed;
  }

  buildDisplayCommand(args: string[], prompt: string): string {
    const displayArgs = args.map((a, i) => {
      if (i > 0 && args[i - 1] === "--prompt") return "<prompt>";
      if (a === prompt && a.length > 50) return "<prompt>";
      return a;
    });
    return `vibe ${displayArgs.join(" ")}`;
  }
}
