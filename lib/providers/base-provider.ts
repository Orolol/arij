/**
 * BaseCliProvider — abstract base class for CLI-based agent providers.
 *
 * Encapsulates the shared provider lifecycle:
 * - child_process.spawn with stdio piping
 * - stdout/stderr buffer collection
 * - SIGTERM → SIGKILL kill logic
 * - Session ID extraction via extractCliSessionIdFromOutput
 * - NDJSON session logging
 * - endedWithQuestion detection
 * - Duration tracking
 * - Display command building
 * - Exit code to success/error mapping
 *
 * Subclasses implement ~3 abstract methods and get everything else for free.
 */

import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import {
  createStreamLog,
  appendStreamEvent,
  appendStderrEvent,
  endStreamLog,
  type StreamLogContext,
} from "@/lib/claude/logger";
import {
  extractCliSessionIdFromOutput,
  hasAskUserQuestion,
} from "@/lib/claude/json-parser";
import type {
  AgentProvider,
  ProviderChunk,
  ProviderResult,
  ProviderSession,
  ProviderSpawnOptions,
  ProviderType,
} from "./types";

export interface BaseProviderChunkCallbacks {
  onRawChunk?: (chunk: {
    source: "stdout" | "stderr";
    index: number;
    text: string;
    emittedAt: string;
  }) => void;
  onOutputChunk?: (chunk: { text: string; emittedAt: string }) => void;
  onResponseChunk?: (chunk: { text: string; emittedAt: string }) => void;
}

/**
 * Abstract base class for CLI agent providers.
 *
 * Subclasses must implement:
 * - `binaryName` — the CLI binary to spawn (e.g. "claude", "codex")
 * - `buildArgs(options)` — construct CLI arguments from spawn options
 * - `extractResult(stdout, stderr)` — extract the agent's final text from output
 *
 * Subclasses may override:
 * - `parseSessionId(stdout, stderr, fallback)` — custom session ID extraction
 * - `isAvailable()` — custom availability check (default: `which <binaryName>`)
 * - `buildEnv()` — custom environment variables
 * - `buildChunkCallbacks(options)` — map ProviderSpawnOptions.onChunk to raw/output/response callbacks
 * - `handleExit(...)` — custom exit handling for providers that need special error detection
 */
export abstract class BaseCliProvider implements AgentProvider {
  abstract readonly type: ProviderType;

  /** The CLI binary name (e.g. "claude", "codex", "gemini"). */
  abstract get binaryName(): string;

  /** Build CLI arguments from spawn options. */
  abstract buildArgs(options: ProviderSpawnOptions): string[];

  /** Extract the agent's final result text from stdout/stderr. */
  abstract extractResult(stdout: string, stderr: string): string;

  /**
   * Extract a CLI session ID from output. Override for providers with
   * non-standard session ID formats. Default uses extractCliSessionIdFromOutput.
   */
  parseSessionId(
    stdout: string,
    stderr: string,
    fallbackId?: string,
  ): string | undefined {
    return (
      extractCliSessionIdFromOutput(stdout) ??
      extractCliSessionIdFromOutput(stderr) ??
      fallbackId ??
      undefined
    );
  }

  /**
   * Build environment variables for the spawned process.
   * Default: inherits process.env.
   */
  buildEnv(): NodeJS.ProcessEnv {
    return { ...process.env };
  }

  /**
   * Build chunk callbacks that map raw/output/response chunks to
   * the unified ProviderChunk callback. Subclasses can override for
   * providers with different streaming behavior.
   */
  buildChunkCallbacks(options: ProviderSpawnOptions): BaseProviderChunkCallbacks {
    const { onChunk } = options;
    if (!onChunk) return {};

    return {
      onRawChunk: ({ source, index, text, emittedAt }) =>
        onChunk({
          streamType: "raw",
          text,
          chunkKey: `${source}:${index}`,
          emittedAt,
        }),
      onOutputChunk: ({ text, emittedAt }) =>
        onChunk({
          streamType: "output",
          text,
          chunkKey: "final-output",
          emittedAt,
        }),
      onResponseChunk: ({ text, emittedAt }) =>
        onChunk({
          streamType: "response",
          text,
          chunkKey: "final-response",
          emittedAt,
        }),
    };
  }

  /**
   * Build a display command string (with prompt redacted).
   * Override for providers with different prompt argument patterns.
   */
  buildDisplayCommand(
    args: string[],
    prompt: string,
  ): string {
    const displayArgs = args.map((a, i) => {
      if (i > 0 && (args[i - 1] === "-p" || args[i - 1] === "--prompt")) {
        return "<prompt>";
      }
      if (a === prompt && a.length > 50) return "<prompt>";
      return a;
    });
    return `${this.binaryName} ${displayArgs.join(" ")}`;
  }

  /**
   * Detect whether the agent ended by asking a question.
   * Default checks all output sources via hasAskUserQuestion.
   */
  detectEndedWithQuestion(stdout: string, stderr: string, result: string): boolean {
    return (
      hasAskUserQuestion(stdout) ||
      hasAskUserQuestion(stderr) ||
      hasAskUserQuestion(result)
    );
  }

  /**
   * Check if the CLI is available. Default: `which <binaryName>`.
   * Override for providers that need additional checks (e.g. login status).
   */
  async isAvailable(): Promise<boolean> {
    try {
      execSync(`which ${this.binaryName}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Spawn the CLI process. This is the core method that orchestrates
   * the entire lifecycle. Most subclasses should NOT override this.
   */
  spawn(options: ProviderSpawnOptions): ProviderSession {
    const { sessionId, prompt, cwd, logIdentifier } = options;
    const cliSessionId = options.cliSessionId ?? options.claudeSessionId;
    const effectiveCwd = cwd || process.cwd();
    const args = this.buildArgs(options);
    const callbacks = this.buildChunkCallbacks(options);

    console.log(
      `[spawn] ${this.binaryName}`,
      args.map((a) => (a.length > 100 ? a.slice(0, 100) + "..." : a)).join(" "),
    );
    console.log("[spawn] cwd:", effectiveCwd);

    // Optional NDJSON logging
    let logCtx: StreamLogContext | null = null;
    if (logIdentifier) {
      try {
        logCtx = createStreamLog(
          `${this.type}-${logIdentifier}`,
          [this.binaryName, ...args],
          prompt,
        );
      } catch {
        // logging is best-effort
      }
    }

    let child: ChildProcess | null = null;
    let killed = false;

    const promise = new Promise<ProviderResult>((resolve) => {
      const startTime = Date.now();
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutChunkIndex = 0;
      let stderrChunkIndex = 0;

      child = nodeSpawn(this.binaryName, args, {
        cwd: effectiveCwd,
        env: this.buildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        stdoutChunkIndex += 1;
        const text = chunk.toString("utf-8");
        callbacks.onRawChunk?.({
          source: "stdout",
          index: stdoutChunkIndex,
          text,
          emittedAt: new Date().toISOString(),
        });
        if (logCtx) {
          try {
            appendStreamEvent(logCtx, text);
          } catch {
            /* best-effort */
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        stderrChunkIndex += 1;
        const text = chunk.toString("utf-8");
        callbacks.onRawChunk?.({
          source: "stderr",
          index: stderrChunkIndex,
          text,
          emittedAt: new Date().toISOString(),
        });
        if (logCtx) {
          try {
            appendStderrEvent(logCtx, text);
          } catch {
            /* best-effort */
          }
        }
      });

      child.on("error", (err) => {
        const duration = Date.now() - startTime;
        const errorMsg = err.message.includes("ENOENT")
          ? `${this.binaryName} CLI not found. Ensure \`${this.binaryName}\` is installed and available in PATH.`
          : `Failed to spawn ${this.binaryName} CLI: ${err.message}`;

        if (logCtx) {
          try {
            endStreamLog(logCtx, { exitCode: null, error: errorMsg });
          } catch {
            /* best-effort */
          }
        }

        resolve({
          success: false,
          error: errorMsg,
          duration,
        });
      });

      child.on("close", (code) => {
        const duration = Date.now() - startTime;
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        const result = this.extractResult(stdout, stderr);
        const parsedCliSessionId = this.parseSessionId(
          stdout,
          stderr,
          cliSessionId,
        );
        const endedWithQuestion = this.detectEndedWithQuestion(
          stdout,
          stderr,
          result,
        );

        // Emit final output/response chunks
        if (result) {
          const emittedAt = new Date().toISOString();
          callbacks.onOutputChunk?.({ text: result, emittedAt });
          callbacks.onResponseChunk?.({ text: result, emittedAt });
        }

        console.log(
          `[spawn] ${this.binaryName} exited, code:`,
          code,
          "duration:",
          duration + "ms",
          "output:",
          result.length,
          "bytes, stderr:",
          stderr.length,
          "bytes",
        );
        if (stderr.trim()) {
          console.log("[spawn] stderr:", stderr.slice(0, 500));
        }
        if (result) {
          console.log("[spawn] output preview:", result.slice(0, 300));
        }

        // Log session end
        if (logCtx) {
          try {
            if (result) appendStreamEvent(logCtx, result);
            endStreamLog(logCtx, {
              exitCode: code,
              error: code !== 0 ? stderr.slice(0, 500) : undefined,
            });
          } catch {
            /* best-effort */
          }
        }

        if (killed) {
          resolve({
            success: false,
            error: "Process was cancelled.",
            duration,
          });
          return;
        }

        if (code !== 0) {
          resolve({
            success: false,
            error: stderr.trim() || `${this.binaryName} CLI exited with code ${code}`,
            result: result || undefined,
            duration,
            cliSessionId: parsedCliSessionId,
            endedWithQuestion,
          });
          return;
        }

        resolve({
          success: true,
          result: result || stdout.trim(),
          duration,
          cliSessionId: parsedCliSessionId,
          endedWithQuestion,
        });
      });
    });

    const kill = () => {
      if (child && !child.killed) {
        killed = true;
        child.kill("SIGTERM");

        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (child && !child.killed) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }
    };

    const command = this.buildDisplayCommand(args, prompt);

    return {
      handle: `${this.type}-${sessionId}`,
      kill,
      promise,
      command,
    };
  }

  cancel(session: ProviderSession): boolean {
    session.kill();
    return true;
  }
}
