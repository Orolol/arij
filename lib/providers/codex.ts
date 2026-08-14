/**
 * Codex provider — runs the `codex` CLI through the shared BaseCliProvider
 * lifecycle.
 *
 * Codex-specific behavior, expressed via the base-class hooks:
 * - `codex exec` in non-interactive mode, with a temp-file output capture
 *   (`-o <tmpfile>`) created in prepareSpawn() and read back in extractResult()
 * - a distinct resume subcommand (`codex exec resume <ID> <PROMPT>`) with its
 *   own, reduced flag set (no -C, -o, --color, -s)
 * - developer instructions injected via `-c developer_instructions="…"`
 * - actionable error detection for stream disconnects and missing login
 * - no CLI session ID extraction (codex output carries none)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS } from "@/lib/codex/constants";
import type { StreamLogContext } from "@/lib/claude/logger";
import {
  BaseCliProvider,
  type BaseProviderChunkCallbacks,
  type ProviderExitInfo,
  type ProviderSpawnContext,
} from "./base-provider";
import type {
  ProviderResult,
  ProviderSpawnOptions,
} from "./types";

interface CodexSpawnContext extends ProviderSpawnContext {
  /** Temp file passed via -o for reliable capture of the final message. */
  outputFile: string;
  /** Contents of the -o file, cached by extractResult() for chunk emission. */
  fileOutput?: string;
}

export class CodexProvider extends BaseCliProvider {
  readonly type = "codex" as const;

  get binaryName(): string {
    return "codex";
  }

  /**
   * Developer instructions injected via `-c developer_instructions=…`.
   * Blank or missing values are omitted from the args.
   */
  protected get developerInstructions(): string | undefined {
    return CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS;
  }

  protected prepareSpawn(_options: ProviderSpawnOptions): CodexSpawnContext {
    // Temp file for -o (reliable output capture)
    return {
      outputFile: path.join(
        os.tmpdir(),
        `codex-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
      ),
    };
  }

  buildArgs(
    options: ProviderSpawnOptions,
    spawnContext?: ProviderSpawnContext,
  ): string[] {
    const { mode, prompt, cwd, model, cliSessionId, resumeSession } = options;
    const effectiveCwd = cwd || process.cwd();
    const isResume = !!(cliSessionId && resumeSession);
    const developerInstructions = this.developerInstructions;

    // `codex exec resume <ID> <PROMPT>` is a separate subcommand with its own
    // flag set (no -C, -o, --color, -s).  Build args accordingly.
    const args: string[] = ["exec"];

    if (isResume) {
      args.push("resume", cliSessionId!);

      // resume only supports a subset of flags
      if (mode === "code") {
        args.push("--dangerously-bypass-approvals-and-sandbox");
      }
      args.push("--skip-git-repo-check");

      if (model) {
        args.push("-m", model);
      }

      if (developerInstructions && developerInstructions.trim()) {
        args.push("-c", `developer_instructions=${JSON.stringify(developerInstructions)}`);
      }

      // Prompt as positional argument (after session ID)
      args.push(prompt);
    } else {
      // --- normal (non-resume) exec ---

      // Sandbox mode
      if (mode === "code") {
        args.push("--dangerously-bypass-approvals-and-sandbox");
      } else if (mode === "analyze") {
        args.push("-s", "workspace-write");
      } else {
        args.push("-s", "read-only");
      }

      args.push("-C", effectiveCwd);
      args.push("--skip-git-repo-check");

      // Capture final message to file (avoids mixing with banners/logs)
      args.push("-o", (spawnContext as CodexSpawnContext).outputFile);

      // No ANSI escape codes
      args.push("--color", "never");

      if (model) {
        args.push("-m", model);
      }

      if (developerInstructions && developerInstructions.trim()) {
        args.push("-c", `developer_instructions=${JSON.stringify(developerInstructions)}`);
      }

      // Prompt as positional argument
      args.push(prompt);
    }

    return args;
  }

  protected beforeSpawn(args: string[], cwd: string): void {
    console.log(
      "[spawn] codex",
      args.map((a) => (a.length > 100 ? a.slice(0, 100) + "..." : a)).join(" ")
    );
    console.log("[spawn] cwd:", cwd);
  }

  extractResult(
    stdout: string,
    _stderr: string,
    spawnContext?: ProviderSpawnContext,
  ): string {
    const ctx = spawnContext as CodexSpawnContext | undefined;

    // Read the -o output file (agent's final message)
    let fileOutput = "";
    if (ctx?.outputFile) {
      try {
        fileOutput = fs.readFileSync(ctx.outputFile, "utf-8").trim();
      } catch {
        // File may not exist if the process failed early
      }
      ctx.fileOutput = fileOutput;
    }

    // Best output: -o file > stdout
    return fileOutput || stdout.trim();
  }

  /**
   * Codex output carries no extractable CLI session ID; resume IDs are
   * tracked by the caller, so results never include one.
   */
  parseSessionId(): string | undefined {
    return undefined;
  }

  /**
   * The final-output chunk is only emitted when the -o file produced
   * content; the response chunk always carries the best available result.
   */
  protected emitFinalChunks(
    result: string,
    callbacks: BaseProviderChunkCallbacks,
    spawnContext?: ProviderSpawnContext,
  ): void {
    const fileOutput = (spawnContext as CodexSpawnContext | undefined)?.fileOutput ?? "";

    if (fileOutput) {
      callbacks.onOutputChunk?.({
        text: fileOutput,
        emittedAt: new Date().toISOString(),
      });
    }

    if (result) {
      callbacks.onResponseChunk?.({
        text: result,
        emittedAt: new Date().toISOString(),
      });
    }
  }

  protected buildSpawnErrorMessage(err: Error): string {
    return err.message.includes("ENOENT")
      ? "Codex CLI not found. Install it with: npm i -g @openai/codex"
      : `Failed to spawn Codex CLI: ${err.message}`;
  }

  protected buildExitError(
    code: number | null,
    stdout: string,
    stderr: string,
  ): string {
    // Detect common Codex CLI errors and provide actionable messages
    const combinedOutput = stderr + "\n" + stdout;

    if (/Reconnecting\.\.\.\s*\d+\/\d+/.test(combinedOutput)) {
      return (
        "Codex API connection failed (stream disconnected). " +
        "Check your network and ChatGPT subscription, or try again later."
      );
    }
    if (/not logged in|login required|unauthorized/i.test(combinedOutput)) {
      return "Codex CLI is not authenticated. Run `codex login` in your terminal.";
    }
    return stderr.trim() || `Codex CLI exited with code ${code}`;
  }

  protected handleExit(
    info: ProviderExitInfo,
    callbacks: BaseProviderChunkCallbacks,
    logCtx: StreamLogContext | null,
  ): ProviderResult {
    const providerResult = super.handleExit(info, callbacks, logCtx);

    const { code, stdout, stderr, duration } = info;
    const fileOutput =
      (info.spawnContext as CodexSpawnContext | undefined)?.fileOutput ?? "";
    const result = fileOutput || stdout.trim();

    console.log(
      "[spawn] codex exited, code:",
      code,
      "duration:",
      duration + "ms",
      "output:",
      result.length,
      "bytes (file:",
      fileOutput.length,
      "/ stdout:",
      stdout.length,
      "), stderr:",
      stderr.length,
      "bytes"
    );
    if (stderr.trim()) {
      console.log("[spawn] stderr:", stderr.slice(0, 500));
    }
    if (result) {
      console.log("[spawn] output preview:", result.slice(0, 300));
    }

    return providerResult;
  }

  protected cleanupSpawnContext(spawnContext?: ProviderSpawnContext): void {
    const outputFile = (spawnContext as CodexSpawnContext | undefined)?.outputFile;
    if (!outputFile) return;
    try {
      fs.unlinkSync(outputFile);
    } catch {
      // ignore
    }
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
