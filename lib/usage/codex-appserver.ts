import { spawn } from "child_process";
import type {
  CodexCredits,
  CodexDailyUsageDay,
  CodexLiveQuota,
  CodexQuotaBucket,
} from "@/lib/types/usage";

/**
 * Live codex quota poller — `codex app-server` JSON-RPC over stdio (camelCase).
 *
 * Protocol ground truth (live-probed with codex-cli 0.141.0 on 2026-08-18,
 * see scratchpad probe_appserver.py / probe_out.txt / appserver.schema.json):
 * handshake = initialize request -> await response -> initialized
 * notification; then `account/rateLimits/read` and `account/usage/read`.
 * Responses carry `id` + `result` and MAY OMIT `jsonrpc` — parsers must not
 * require it. Notifications (no `id`) interleave as noise.
 *
 * SPAWN-SAFETY CONTRACT (feature-level, non-negotiable):
 * - The four frames below (initialize, initialized, rateLimits read, usage
 *   read) are the COMPLETE allowed surface. Never `account/read` (it returns
 *   the account EMAIL — probe-only, never production), never a thread/turn
 *   method. Zero model tokens, never a session.
 * - argv array + shell:false, hard 10s timeout then SIGKILL, unref'd child
 *   and timer (orphan-proof), stdin closed once all frames are written.
 * - EVERY failure (binary missing, timeout, malformed frames, non-zero exit)
 *   resolves to null; callers fall back to the rollout-file snapshot.
 * - Never reads ~/.codex/auth.json; the CLI uses its own stored auth.
 *
 * Window semantics are NOT constant: this account moved primary 300 /
 * secondary 10080 -> primary 10080 / secondary null. Never hardcode window
 * meaning; pass windowDurationMins/resetsAt through as delivered. resetsAt is
 * unix SECONDS here vs claude's ISO strings — separate parsers by design.
 * Official-but-experimental surface: fixtures pin today's shapes so a CLI
 * upgrade shows up as test-visible drift, not a crash.
 */

export const CODEX_APPSERVER_ARGV = ["codex", "app-server"] as const;

/** Matches package.json — a constant on purpose, never an fs read at runtime. */
const ARIJ_VERSION = "0.1.0";

export function buildInitializeFrame(id: number): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      clientInfo: { name: "arij", title: "Arij", version: ARIJ_VERSION },
    },
  });
}

export const INITIALIZED_FRAME = '{"jsonrpc":"2.0","method":"initialized"}';

export function buildRateLimitsFrame(id: number): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "account/rateLimits/read",
    params: {},
  });
}

export function buildUsageFrame(id: number): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "account/usage/read",
    params: {},
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * PURE: first parseable line whose `id` matches and that carries a `result`
 * key -> that result. A matching `error` frame, or no match at all, -> null.
 * Does NOT require a `jsonrpc` key (probe_out.txt responses omit it);
 * notifications (no `id`) are skipped noise.
 */
export function findResponseFrame(
  lines: readonly string[],
  id: number,
): unknown | null {
  for (const line of lines) {
    const trimmed = typeof line === "string" ? line.trim() : "";
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed.id !== id) continue;
    if ("result" in parsed) return parsed.result;
    return null; // matching error frame — the read failed
  }
  return null;
}

/** A bucket survives only with a string limitId and a finite primary.usedPercent. */
function parseBucket(value: unknown): CodexQuotaBucket | null {
  if (!isRecord(value)) return null;
  const limitId = value.limitId;
  if (typeof limitId !== "string" || limitId.length === 0) return null;
  const primary = value.primary;
  if (!isRecord(primary)) return null;
  const usedPercent = finiteOrNull(primary.usedPercent);
  if (usedPercent === null) return null;

  let secondary: CodexQuotaBucket["secondary"] = null;
  if (isRecord(value.secondary)) {
    const secondaryUsed = finiteOrNull(value.secondary.usedPercent);
    if (secondaryUsed !== null) {
      secondary = {
        usedPercent: secondaryUsed,
        windowDurationMins: finiteOrNull(value.secondary.windowDurationMins),
        resetsAtUnix: finiteOrNull(value.secondary.resetsAt),
      };
    }
  }

  return {
    limitId,
    limitName: strOrNull(value.limitName),
    usedPercent,
    windowDurationMins: finiteOrNull(primary.windowDurationMins),
    resetsAtUnix: finiteOrNull(primary.resetsAt),
    secondary,
  };
}

function parseCredits(value: unknown): CodexCredits | null {
  if (
    !isRecord(value) ||
    typeof value.hasCredits !== "boolean" ||
    typeof value.unlimited !== "boolean"
  ) {
    return null;
  }
  return {
    hasCredits: value.hasCredits,
    unlimited: value.unlimited,
    balance: strOrNull(value.balance),
  };
}

function parseDailyUsage(value: unknown): CodexDailyUsageDay[] {
  if (!Array.isArray(value)) return [];
  const result: CodexDailyUsageDay[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const date = entry.startDate;
    const tokens = finiteOrNull(entry.tokens);
    if (typeof date !== "string" || tokens === null) continue;
    result.push({ date, tokens });
  }
  return result;
}

/**
 * PURE: collected stdout lines -> CodexLiveQuota (+ the raw rateLimits result
 * JSON that feeds the snapshot upsert), or null. Never throws.
 *
 * The rateLimits result is REQUIRED (missing -> null); the usage result is
 * optional (rate limits alone are still worth showing -> dailyUsage []/
 * lifetimeTokens null). Buckets come from `rateLimitsByLimitId` — "codex"
 * key first, then object-key order; when the map is absent/empty (the
 * historical dual-window shape) the top-level `rateLimits` object becomes the
 * single bucket. At least one surviving bucket is required.
 */
export function parseCodexLiveQuota(
  lines: readonly string[],
  rateLimitsId: number,
  usageId: number,
): { quota: CodexLiveQuota; rawRateLimitsJson: string } | null {
  const rateLimitsResult = findResponseFrame(lines, rateLimitsId);
  if (!isRecord(rateLimitsResult)) {
    console.warn("[usage] codex app-server response shape not recognized");
    return null;
  }

  const topLevel = isRecord(rateLimitsResult.rateLimits)
    ? rateLimitsResult.rateLimits
    : null;

  const buckets: CodexQuotaBucket[] = [];
  const byLimitId = rateLimitsResult.rateLimitsByLimitId;
  if (isRecord(byLimitId)) {
    // "codex" first, then the remaining keys in object order.
    const keys = Object.keys(byLimitId);
    const ordered = keys.includes("codex")
      ? ["codex", ...keys.filter((key) => key !== "codex")]
      : keys;
    for (const key of ordered) {
      const bucket = parseBucket(byLimitId[key]);
      if (bucket) buckets.push(bucket);
    }
  }
  if (buckets.length === 0) {
    // Historical single-limit shape without the map (probe: plus account,
    // primary 300 / secondary 10080).
    const fallback = parseBucket(topLevel);
    if (fallback) buckets.push(fallback);
  }
  if (buckets.length === 0) {
    console.warn("[usage] codex app-server response shape not recognized");
    return null;
  }

  // Usage read is best-effort extra context.
  const usageResult = findResponseFrame(lines, usageId);
  const summary =
    isRecord(usageResult) && isRecord(usageResult.summary)
      ? usageResult.summary
      : null;

  return {
    quota: {
      planType: topLevel ? strOrNull(topLevel.planType) : null,
      buckets,
      credits: topLevel ? parseCredits(topLevel.credits) : null,
      dailyUsage: isRecord(usageResult)
        ? parseDailyUsage(usageResult.dailyUsageBuckets)
        : [],
      lifetimeTokens: summary ? finiteOrNull(summary.lifetimeTokens) : null,
    },
    rawRateLimitsJson: JSON.stringify(rateLimitsResult),
  };
}

/** Injectable so tests drive fixture frames — vitest NEVER spawns the CLI. */
export type AppServerRunner = (
  argv: readonly string[],
  timeoutMs: number,
) => Promise<string[] | null>;

export const APPSERVER_TIMEOUT_MS = 10_000;

const INITIALIZE_ID = 1;
const RATE_LIMITS_ID = 2;
const USAGE_ID = 3;

/**
 * The ONLY place that spawns codex. Resolves ALL stdout lines collected once
 * responses for both reads (id 2 and id 3) have been seen, or null on any
 * failure. Never rejects, never a session, never a turn, zero model tokens.
 */
export function runCodexAppServerProbe(
  argv: readonly string[],
  timeoutMs: number,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        stdio: ["pipe", "pipe", "ignore"],
        shell: false, // argv array, never a shell string
      });
    } catch {
      resolve(null);
      return;
    }

    const lines: string[] = [];
    let buffer = "";
    let settled = false;
    let initialized = false;
    const seenIds = new Set<number>();

    const settle = (value: string[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      resolve(value);
    };

    const timer = setTimeout(() => settle(null), timeoutMs);
    timer.unref();
    child.unref();

    child.on("error", () => settle(null)); // ENOENT: codex not installed
    child.on("close", () => settle(null)); // exited before both reads answered

    const writeLine = (frame: string) => {
      try {
        child.stdin?.write(frame + "\n");
      } catch {
        settle(null);
      }
    };

    const onLine = (line: string) => {
      lines.push(line);
      // Light per-line JSON.parse for id matching — an includes-check on
      // '"id":2' would be fragile against key order/whitespace.
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(parsed) || typeof parsed.id !== "number") return;
      seenIds.add(parsed.id);

      if (parsed.id === INITIALIZE_ID && !initialized) {
        // Handshake step 2 (live-verified order, probe_out.txt): only after
        // the initialize RESPONSE do we send the initialized notification and
        // the two reads. stdin MUST then stay open: codex app-server treats
        // stdin EOF as "client disconnected" and shuts down BEFORE answering
        // (live-verified 2026-08-18: EOF right after the writes closes stdout
        // in ~0.5s with zero responses). Nothing more is ever written, and
        // settle()'s SIGKILL tears the pipe down on every exit path.
        initialized = true;
        writeLine(INITIALIZED_FRAME);
        writeLine(buildRateLimitsFrame(RATE_LIMITS_ID));
        writeLine(buildUsageFrame(USAGE_ID));
        return;
      }

      if (seenIds.has(RATE_LIMITS_ID) && seenIds.has(USAGE_ID)) {
        settle([...lines]);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) onLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
    child.stdout?.on("error", () => settle(null));
    child.stdin?.on("error", () => {
      // EPIPE if the server died mid-handshake — close handler settles null.
    });

    // Handshake step 1: initialize, then WAIT for its response (onLine).
    writeLine(buildInitializeFrame(INITIALIZE_ID));
  });
}

/**
 * Poll codex for live quota. Never throws; every failure is null (the API
 * route then serves the rollout-snapshot fallback untouched).
 */
export async function fetchCodexLiveQuota(
  runner: AppServerRunner = runCodexAppServerProbe,
): Promise<{ quota: CodexLiveQuota; rawRateLimitsJson: string } | null> {
  try {
    const lines = await runner(CODEX_APPSERVER_ARGV, APPSERVER_TIMEOUT_MS);
    if (lines === null) return null;
    return parseCodexLiveQuota(lines, RATE_LIMITS_ID, USAGE_ID);
  } catch {
    return null;
  }
}
