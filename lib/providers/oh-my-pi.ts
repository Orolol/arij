/**
 * Oh My Pi provider — wraps the `omp` CLI (github.com/can1357/oh-my-pi).
 *
 * Oh My Pi started life as a pi extension, but has since become a standalone
 * fork of pi: its own compiled `omp` binary, its own session store
 * (~/.omp/agent), no `pi` install required. The `--mode json` event stream is
 * unchanged from pi (verified live against omp 17.2.1: same
 * `{"type":"session",…}` header, same message_start/message_end shapes), so
 * event parsing, result extraction and failure detection are all inherited
 * from PiProvider.
 *
 * CLI: omp --mode json [--tools <allowlist>] [--resume <ID>] [--model <M>] -p <PROMPT>
 *
 * (omp's `-p` is a boolean `--print` flag with the prompt as a positional
 * argument, so the argv shape happens to match pi's `-p <PROMPT>` exactly.)
 *
 * Divergences from pi, each overridden below:
 * - binary: `omp`, not `pi` — no extension flag, the orchestrator IS the CLI
 * - resume: `--resume <ID>` (omp has no `--session` flag); resuming re-emits
 *   the session header with the SAME id, so the stored id stays stable
 * - read-only tools: omp ships `glob` instead of pi's `find`/`ls`
 */

import { PiProvider } from "./pi";
import type { ProviderType } from "./types";

/** omp built-ins that cannot modify the working tree. */
export const OMP_READONLY_TOOLS = ["read", "grep", "glob"];

export class OhMyPiProvider extends PiProvider {
  readonly type: ProviderType = "oh-my-pi";

  get binaryName(): string {
    return "omp";
  }

  protected get cliDisplayName(): string {
    return "Oh My Pi";
  }

  protected readonlyTools(): string[] {
    return OMP_READONLY_TOOLS;
  }

  protected resumeArgs(cliSessionId: string): string[] {
    return ["--resume", cliSessionId];
  }

  protected notAuthenticatedMessage(): string {
    return "Oh My Pi is not authenticated. Run `omp` and use /login, or set the provider API key.";
  }

  protected buildSpawnErrorMessage(err: Error): string {
    return err.message.includes("ENOENT")
      ? "Oh My Pi CLI not found. Ensure `omp` is installed and on PATH (https://github.com/can1357/oh-my-pi)."
      : `Failed to spawn Oh My Pi CLI: ${err.message}`;
  }
}
