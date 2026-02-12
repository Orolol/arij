import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(process.cwd(), "data", "logs");

export interface StreamLogContext {
  filePath: string;
  startTime: number;
  chunkCount: number;
}

/**
 * Creates a new NDJSON log file for a Claude CLI stream session.
 */
export function createStreamLog(
  identifier: string,
  cliArgs: string[],
  prompt: string
): StreamLogContext {
  mkdirSync(LOGS_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = identifier.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  const filePath = join(LOGS_DIR, `${ts}-${safe}.ndjson`);

  const header = {
    _type: "session_start",
    ts: new Date().toISOString(),
    identifier,
    cliArgs,
    promptLength: prompt.length,
  };

  writeFileSync(filePath, JSON.stringify(header) + "\n", "utf-8");

  return { filePath, startTime: Date.now(), chunkCount: 0 };
}

/**
 * Appends a raw NDJSON event line to the log file.
 */
export function appendStreamEvent(
  ctx: StreamLogContext,
  rawLine: string
): void {
  ctx.chunkCount++;
  const entry = {
    _type: "raw",
    ts: new Date().toISOString(),
    seq: ctx.chunkCount,
    data: rawLine,
  };
  appendFileSync(ctx.filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Appends a stderr line to the log.
 */
export function appendStderrEvent(
  ctx: StreamLogContext,
  text: string
): void {
  const entry = {
    _type: "stderr",
    ts: new Date().toISOString(),
    text,
  };
  appendFileSync(ctx.filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Writes the end-of-session summary to the log file.
 */
export function endStreamLog(
  ctx: StreamLogContext,
  info: { exitCode: number | null; error?: string }
): void {
  const entry = {
    _type: "session_end",
    ts: new Date().toISOString(),
    durationMs: Date.now() - ctx.startTime,
    totalChunks: ctx.chunkCount,
    exitCode: info.exitCode,
    error: info.error,
  };
  appendFileSync(ctx.filePath, JSON.stringify(entry) + "\n", "utf-8");
}
