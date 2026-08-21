/**
 * Pure parser for codex's provider-emitted `rate_limits` snapshots.
 *
 * Codex writes one JSONL line per event into
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; some of those carry the
 * account's real rate-limit state:
 *
 * ```json
 * {"timestamp":"2026-05-15T19:18:02.862Z","type":"event_msg","payload":{
 *   "type":"token_count","info":null,"rate_limits":{
 *     "limit_id":"codex","primary":{"used_percent":1.0,"window_minutes":300,
 *     "resets_at":1778890682},"secondary":{"used_percent":0.0,
 *     "window_minutes":10080,"resets_at":1779477482},"credits":null,
 *     "plan_type":"plus","rate_limit_reached_type":null}}}
 * ```
 *
 * This module is deliberately dependency-free and side-effect-free: no fs, no
 * db, no clock. It never throws and never invents a value — a field that is
 * absent or non-finite becomes `null`, so the UI can honestly render an
 * em-dash instead of a fabricated zero. Numbers are passed through EXACTLY as
 * emitted (`resets_at` stays unix SECONDS; `used_percent` is never
 * extrapolated forward in time).
 */

export interface ParsedRateLimitWindow {
  usedPercent: number;            // finite, as emitted (e.g. 6.0)
  windowMinutes: number | null;   // 300 = 5h, 10080 = weekly
  resetsAt: number | null;        // unix SECONDS, as emitted
}

export interface ParsedRateLimitSnapshot {
  capturedAt: string;             // the line's own `timestamp` (ISO UTC)
  planType: string | null;        // e.g. "prolite"
  primary: ParsedRateLimitWindow | null;
  secondary: ParsedRateLimitWindow | null;
  rawJson: string;                // JSON.stringify of the rate_limits object
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finite number or null — rejects NaN/Infinity/strings/booleans/null. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A window survives only when `used_percent` is a finite number — that is the
 * one field the gauge cannot fake. `window_minutes` / `resets_at` degrade to
 * null individually (the UI then hides the countdown, not the gauge).
 */
function parseWindow(value: unknown): ParsedRateLimitWindow | null {
  if (!isRecord(value)) return null;
  const usedPercent = finiteOrNull(value.used_percent);
  if (usedPercent === null) return null;
  return {
    usedPercent,
    windowMinutes: finiteOrNull(value.window_minutes),
    resetsAt: finiteOrNull(value.resets_at),
  };
}

/**
 * One JSONL line -> snapshot, or null. Never throws.
 *
 * A line qualifies iff it parses as JSON, has a non-empty string `timestamp`,
 * and `payload.rate_limits` is an object. `payload.type === "token_count"` is
 * deliberately NOT required: codex may attach rate_limits to other event
 * types, and a stricter check would silently drop real quota data.
 */
export function parseRateLimitLine(line: string): ParsedRateLimitSnapshot | null {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const timestamp = parsed.timestamp;
  if (typeof timestamp !== "string" || timestamp.length === 0) return null;

  const payload = parsed.payload;
  if (!isRecord(payload)) return null;

  const rateLimits = payload.rate_limits;
  if (!isRecord(rateLimits)) return null;

  return {
    capturedAt: timestamp,
    planType:
      typeof rateLimits.plan_type === "string" ? rateLimits.plan_type : null,
    primary: parseWindow(rateLimits.primary),
    secondary: parseWindow(rateLimits.secondary),
    rawJson: JSON.stringify(rateLimits),
  };
}

/**
 * Whole-file content -> LAST parseable snapshot.
 *
 * Rollout files are append-only, so the positionally-last rate_limits line is
 * the newest state of the account. Scanning in REVERSE and stopping at the
 * first hit also means a multi-megabyte transcript costs only the tail.
 * Returns null when the file carries no rate_limits line at all.
 */
export function extractLatestRateLimitSnapshot(
  content: string,
): ParsedRateLimitSnapshot | null {
  if (typeof content !== "string" || content.length === 0) return null;
  const lines = content.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const snapshot = parseRateLimitLine(lines[i]);
    if (snapshot) return snapshot;
  }
  return null;
}
