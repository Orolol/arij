import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import type { ClaudeResult, SpawnedClaude } from "@/lib/claude/spawn";
import {
  createStreamLog,
  appendStreamEvent,
  appendStderrEvent,
  endStreamLog,
  type StreamLogContext,
} from "@/lib/claude/logger";

export interface GeminiOptions {
  mode: "plan" | "code" | "analyze";
  prompt: string;
  cwd?: string;
  model?: string;
  onRawChunk?: (chunk: {
    source: "stdout" | "stderr";
    index: number;
    text: string;
    emittedAt: string;
  }) => void;
  onOutputChunk?: (chunk: { text: string; emittedAt: string }) => void;
  onResponseChunk?: (chunk: { text: string; emittedAt: string }) => void;
  /** Optional identifier for NDJSON session logging. */
  logIdentifier?: string;
}

/**
 * Spawns the `gemini` CLI and returns a promise that resolves with the result
 * once the process exits.
 *
 * Uses `--output-format stream-json` for streaming JSONL output and `--yolo`
 * for non-interactive (auto-approve) mode.
 *
 * Mirrors the `spawnClaude()` / `spawnCodex()` interface so all three can
 * be used interchangeably by the process manager.
 */
export function spawnGemini(options: GeminiOptions): SpawnedClaude {
  const {
    mode,
    prompt,
    cwd,
    model,
    onRawChunk,
    onOutputChunk,
    onResponseChunk,
    logIdentifier,
  } = options;

  const args: string[] = [];

  // Sandbox/approval mode
  if (mode === "plan") {
    // read-only: use sandbox
    args.push("--sandbox");
  } else {
    // code/analyze: auto-approve all actions
    args.push("--yolo");
  }

  // Working directory
  const effectiveCwd = cwd || process.cwd();

  // Model override
  if (model) {
    args.push("--model", model);
  }

  // Prompt (positional)
  args.push("--prompt", prompt);

  console.log(
    "[spawn] gemini",
    args.map((a) => (a.length > 100 ? a.slice(0, 100) + "..." : a)).join(" ")
  );
  console.log("[spawn] cwd:", effectiveCwd);

  // Optional NDJSON logging
  let logCtx: StreamLogContext | null = null;
  if (logIdentifier) {
    try {
      logCtx = createStreamLog(`gemini-${logIdentifier}`, ["gemini", ...args], prompt);
    } catch {
      // logging is best-effort
    }
  }

  let child: ChildProcess | null = null;
  let killed = false;

  const promise = new Promise<ClaudeResult>((resolve) => {
    const startTime = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutChunkIndex = 0;
    let stderrChunkIndex = 0;

    // Accumulate text from streaming JSONL events
    const textParts: string[] = [];

    child = nodeSpawn("gemini", args, {
      cwd: effectiveCwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let lineBuffer = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      stdoutChunkIndex += 1;
      const text = chunk.toString("utf-8");

      onRawChunk?.({
        source: "stdout",
        index: stdoutChunkIndex,
        text,
        emittedAt: new Date().toISOString(),
      });

      if (logCtx) {
        try { appendStreamEvent(logCtx, text); } catch { /* best-effort */ }
      }

      // Parse JSONL lines for text extraction
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          const extracted = extractGeminiText(event);
          if (extracted) {
            textParts.push(extracted);
          }
        } catch {
          // Not JSON — treat as plain text output
          textParts.push(trimmed);
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrChunkIndex += 1;
      onRawChunk?.({
        source: "stderr",
        index: stderrChunkIndex,
        text: chunk.toString("utf-8"),
        emittedAt: new Date().toISOString(),
      });
      if (logCtx) {
        try { appendStderrEvent(logCtx, chunk.toString("utf-8")); } catch { /* best-effort */ }
      }
    });

    child.on("error", (err) => {
      const duration = Date.now() - startTime;

      const errorMsg = err.message.includes("ENOENT")
        ? "Gemini CLI not found. Install it with: npm i -g @anthropic-ai/claude-code && gemini --version"
        : `Failed to spawn Gemini CLI: ${err.message}`;

      if (logCtx) {
        try { endStreamLog(logCtx, { exitCode: null, error: errorMsg }); } catch { /* best-effort */ }
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

      // Process any remaining buffer
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer.trim());
          const extracted = extractGeminiText(event);
          if (extracted) textParts.push(extracted);
        } catch {
          textParts.push(lineBuffer.trim());
        }
      }

      // Best result: accumulated text from events, fallback to raw stdout
      const result = textParts.join("") || stdout.trim();

      if (result) {
        onOutputChunk?.({
          text: result,
          emittedAt: new Date().toISOString(),
        });
        onResponseChunk?.({
          text: result,
          emittedAt: new Date().toISOString(),
        });
      }

      console.log(
        "[spawn] gemini exited, code:",
        code,
        "duration:",
        duration + "ms",
        "output:",
        result.length,
        "bytes, stderr:",
        stderr.length,
        "bytes"
      );
      if (stderr.trim()) {
        console.log("[spawn] stderr:", stderr.slice(0, 500));
      }
      if (result) {
        console.log("[spawn] output preview:", result.slice(0, 300));
      }

      if (logCtx) {
        try {
          if (result) appendStreamEvent(logCtx, result);
          endStreamLog(logCtx, { exitCode: code, error: code !== 0 ? stderr.slice(0, 500) : undefined });
        } catch { /* best-effort */ }
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
        const combinedOutput = stderr + "\n" + stdout;
        let error: string;

        if (/not authenticated|login required|unauthorized|UNAUTHENTICATED/i.test(combinedOutput)) {
          error =
            "Gemini CLI is not authenticated. Run `gemini auth login` in your terminal.";
        } else if (/model.*not found|invalid model/i.test(combinedOutput)) {
          error =
            "Invalid Gemini model name. Check available models with `gemini models list`.";
        } else {
          error = stderr.trim() || `Gemini CLI exited with code ${code}`;
        }

        resolve({
          success: false,
          error,
          result: result || undefined,
          duration,
        });
        return;
      }

      resolve({
        success: true,
        result,
        duration,
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

  return { promise, kill };
}

/**
 * Extract text content from a Gemini CLI streaming JSON event.
 *
 * Gemini CLI outputs JSONL where text events typically contain:
 * - `{ "type": "text", "text": "..." }`
 * - `{ "type": "content_block_delta", "delta": { "text": "..." } }`
 * - `{ "content": [{ "text": "..." }] }`
 * - Plain text that is just the model response
 */
function extractGeminiText(event: Record<string, unknown>): string | null {
  // Direct text field
  if (event.type === "text" && typeof event.text === "string") {
    return event.text;
  }

  // Delta-style events
  if (
    event.type === "content_block_delta" &&
    event.delta &&
    typeof event.delta === "object" &&
    "text" in (event.delta as Record<string, unknown>)
  ) {
    const text = (event.delta as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }

  // Content array style
  if (Array.isArray(event.content)) {
    const texts = (event.content as Array<Record<string, unknown>>)
      .filter((b) => typeof b.text === "string")
      .map((b) => b.text as string);
    if (texts.length > 0) return texts.join("");
  }

  // Result event
  if (event.type === "result" && typeof event.result === "string") {
    return event.result;
  }

  return null;
}
