import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(process.cwd(), "data", "logs");

export interface StreamLogContext {
  filePath: string;
  startTime: number;
  chunkCount: number;
}

/** Placeholder written in place of a per-session Arij MCP bearer token. */
export const MCP_TOKEN_MASK = "arij-mcp-***";

/**
 * `ARIJ_MCP_TOKEN="…"` (codex TOML inline table) and `"ARIJ_MCP_TOKEN":"…"`
 * (claude inline JSON config). Matching the assignment rather than the value
 * keeps the mask working if the mint format ever changes.
 */
const MCP_TOKEN_ASSIGNMENT_RE = /("?ARIJ_MCP_TOKEN"?\s*[:=]\s*)"[^"]*"/g;

/** Bare token literals, wherever they appear (unquoted values, env dumps, …). */
const MCP_BARE_TOKEN_RE = /arij-mcp-[A-Za-z0-9_-]+/g;

/**
 * Strips per-session Arij MCP bearer tokens out of a CLI argv before it is
 * written anywhere durable.
 *
 * The NDJSON session log header records the full argv, and the codex spawn
 * path carries the token inside a `-c mcp_servers.arij.env={…}` element
 * (codex's `-c` mechanism has no file form, so the value must ride in argv).
 * Idempotent: the mask itself contains no characters the patterns match.
 */
export function redactMcpToken(args: string[]): string[] {
  return args.map((arg) =>
    arg
      .replace(MCP_TOKEN_ASSIGNMENT_RE, `$1"${MCP_TOKEN_MASK}"`)
      .replace(MCP_BARE_TOKEN_RE, MCP_TOKEN_MASK),
  );
}

/**
 * Creates a new NDJSON log file for a Claude CLI stream session.
 *
 * `cliArgs` goes through `redactMcpToken` here — this function is the single
 * logging boundary every provider funnels through, so masking at this point
 * covers current and future callers by construction.
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
    cliArgs: redactMcpToken(cliArgs),
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
