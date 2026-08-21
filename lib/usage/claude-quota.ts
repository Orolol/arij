import { spawn } from "child_process";
import { createId } from "@/lib/utils/nanoid";
import type {
  ClaudeExtraUsage,
  ClaudeModelScopedWindow,
  ClaudeQuota,
  ClaudeQuotaWindow,
} from "@/lib/types/usage";

/**
 * Live claude-code quota poller — control_request get_usage over stream-json.
 *
 * Protocol ground truth (live-probed with claude 2.1.221 on 2026-08-18, see
 * scratchpad probe.js): spawn
 *   claude -p --input-format stream-json --output-format stream-json --verbose
 * write ONE control_request line, read NDJSON on stdout until the matching
 * control_response arrives (~2s, total_cost_usd 0 — a metadata read, not a
 * turn). `--bare` is deliberately NOT used: it skips OAuth and yields
 * `rate_limits_available:false`. `-p` + stream-json output requires
 * `--verbose`.
 *
 * SPAWN-SAFETY CONTRACT (feature-level, non-negotiable):
 * - Metadata only, ZERO model tokens: the get_usage control_request is the
 *   only line ever written to stdin — no prompt, ever.
 * - argv array + shell:false, hard 10s timeout then SIGKILL, unref'd child
 *   and timer (orphan-proof), stdin closed right after the single write.
 * - EVERY failure path (binary missing, timeout, malformed JSON,
 *   rate_limits_available:false, non-zero exit) resolves to null — callers
 *   fall back to the metered-via-Arij card, nothing throws.
 * - Never reads ~/.claude/.credentials.json; the CLI uses its own stored auth.
 *
 * The parser is PURE (no fs/db/clock, never throws) so vitest exercises it on
 * fixture transcripts verbatim — zero real spawns in tests. The runtime
 * response carries many churn-prone keys (seven_day_cowork, tangelo,
 * iguana_necktie...); we consume ONLY the stable subset and ignore the rest,
 * so a CLI upgrade surfaces as fixture drift, not a crash. Both this and the
 * codex mechanism are official-but-experimental surfaces.
 *
 * resets_at here is an ISO-8601 STRING; codex emits unix SECONDS — the two
 * parsers are separate on purpose and never share conversion code.
 */

export const CLAUDE_USAGE_ARGV = [
  "claude",
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
] as const;

export const PROBE_TIMEOUT_MS = 10_000;

/** The single line ever written to claude's stdin — a metadata read, no prompt. */
export function buildGetUsageRequestLine(requestId: string): string {
  return JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype: "get_usage" },
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

/** A window survives only with a finite `utilization`; `resets_at` degrades to null. */
function parseQuotaWindow(value: unknown): ClaudeQuotaWindow | null {
  if (!isRecord(value)) return null;
  const utilization = finiteOrNull(value.utilization);
  if (utilization === null) return null;
  return {
    utilizationPercent: utilization,
    resetsAtIso: strOrNull(value.resets_at),
  };
}

function parseModelScoped(value: unknown): ClaudeModelScopedWindow[] {
  if (!Array.isArray(value)) return [];
  const result: ClaudeModelScopedWindow[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const displayName = entry.display_name;
    const utilization = finiteOrNull(entry.utilization);
    if (typeof displayName !== "string" || utilization === null) continue;
    result.push({
      displayName,
      utilizationPercent: utilization,
      resetsAtIso: strOrNull(entry.resets_at),
    });
  }
  return result;
}

function parseExtraUsage(value: unknown): ClaudeExtraUsage | null {
  if (!isRecord(value) || typeof value.is_enabled !== "boolean") return null;
  return {
    isEnabled: value.is_enabled,
    monthlyLimit: finiteOrNull(value.monthly_limit),
    usedCredits: finiteOrNull(value.used_credits),
    utilizationPercent: finiteOrNull(value.utilization),
  };
}

/**
 * PURE parser: NDJSON stdout -> ClaudeQuota, or null. Never throws.
 *
 * Unparseable / irrelevant lines (the system init message, tool noise) are
 * expected and skipped silently. The one line that matters is
 * `{type:"control_response",response:{subtype:"success",request_id,response}}`
 * with OUR request_id. Everything gates on `rate_limits_available === true`:
 * false (e.g. an OAuth-less account) means null, never a partial object.
 * Churn keys inside rate_limits (seven_day_cowork, tangelo, iguana_necktie
 * and whatever ships next) are ignored WITHOUT logging — only a wholly
 * unusable payload earns the single dev-log line.
 */
export function parseClaudeQuota(
  stdout: string,
  requestId: string,
): ClaudeQuota | null {
  if (typeof stdout !== "string" || stdout.length === 0) return null;

  let payload: Record<string, unknown> | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // truncated/noise line — expected on a killed stream
    }
    if (!isRecord(parsed) || parsed.type !== "control_response") continue;
    const response = parsed.response;
    if (
      !isRecord(response) ||
      response.subtype !== "success" ||
      response.request_id !== requestId
    ) {
      continue;
    }
    if (isRecord(response.response)) payload = response.response;
    break;
  }

  if (!payload) return null;
  if (payload.rate_limits_available !== true) {
    // OAuth-less / --bare-style account: no live quota exists to show.
    return null;
  }

  const rateLimits = isRecord(payload.rate_limits) ? payload.rate_limits : {};

  const quota = {
    subscriptionType: strOrNull(payload.subscription_type),
    fiveHour: parseQuotaWindow(rateLimits.five_hour),
    sevenDay: parseQuotaWindow(rateLimits.seven_day),
    sevenDayOpus: parseQuotaWindow(rateLimits.seven_day_opus),
    sevenDaySonnet: parseQuotaWindow(rateLimits.seven_day_sonnet),
    modelScoped: parseModelScoped(payload.model_scoped),
    extraUsage: parseExtraUsage(payload.extra_usage),
  };

  // Mirror the codex parser's >=1-bucket rule: if window-key churn leaves
  // nothing parseable, report "no live quota" so the card falls back to
  // metered truth instead of rendering a live card with zero gauges.
  const hasAnyData =
    quota.fiveHour !== null ||
    quota.sevenDay !== null ||
    quota.sevenDayOpus !== null ||
    quota.sevenDaySonnet !== null ||
    quota.modelScoped.length > 0 ||
    quota.extraUsage !== null;
  if (!hasAnyData) return null;

  return quota;
}

/** Injectable so tests drive fixture transcripts — vitest NEVER spawns the CLI. */
export type ClaudeProbeRunner = (
  argv: readonly string[],
  stdinLine: string,
  timeoutMs: number,
) => Promise<string | null>;

/**
 * The ONLY place that spawns claude. Resolves the raw stdout capture, or null
 * on any failure (ENOENT, timeout, exit-before-response). Never rejects.
 */
export function runClaudeProbe(
  argv: readonly string[],
  stdinLine: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        // stderr ignored: OAuth chatter is not ours to parse.
        stdio: ["pipe", "pipe", "ignore"],
        shell: false, // argv array, never a shell string
      });
    } catch {
      resolve(null);
      return;
    }

    let stdout = "";
    let settled = false;

    const settle = (value: string | null) => {
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

    // Hard timeout -> SIGKILL -> null. unref'd so a hung CLI cannot pin the
    // Next.js process open (orphan-proof).
    const timer = setTimeout(() => settle(null), timeoutMs);
    timer.unref();
    child.unref();

    child.on("error", () => settle(null)); // ENOENT: claude not installed
    child.on("close", () => {
      // Exited on its own before the response line — parser would fail anyway,
      // but a captured buffer that never contained a control_response is a
      // failure regardless of exit code.
      settle(stdout.includes('"control_response"') ? stdout : null);
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      // Resolve EARLY on the cheap includes-check; parseClaudeQuota does the
      // real validation. Waiting for process exit would burn the whole
      // timeout on a CLI that idles after answering.
      if (stdout.includes('"control_response"') && stdout.includes("\n")) {
        const lastNewline = stdout.lastIndexOf("\n");
        if (stdout.slice(0, lastNewline + 1).includes('"control_response"')) {
          settle(stdout);
        }
      }
    });
    child.stdout?.on("error", () => settle(null));

    // The metadata request is the ONLY write; stdin closes immediately after
    // (spawn-safety: no prompt bytes can ever follow). Live-verified that
    // claude 2.1.221 still answers the pending get_usage after stdin EOF.
    try {
      child.stdin?.on("error", () => {
        // EPIPE if the CLI died first — the close handler settles null.
      });
      child.stdin?.write(stdinLine + "\n");
      child.stdin?.end();
    } catch {
      settle(null);
    }
  });
}

/**
 * Poll claude for live quota. Never throws; every failure is null (the API
 * route then serves the metered-via-Arij fallback untouched).
 */
export async function fetchClaudeQuota(
  runner: ClaudeProbeRunner = runClaudeProbe,
): Promise<ClaudeQuota | null> {
  const requestId = createId();
  try {
    const stdout = await runner(
      CLAUDE_USAGE_ARGV,
      buildGetUsageRequestLine(requestId),
      PROBE_TIMEOUT_MS,
    );
    if (stdout === null) return null;
    const quota = parseClaudeQuota(stdout, requestId);
    if (quota === null) {
      console.warn("[usage] claude get_usage response not usable");
    }
    return quota;
  } catch {
    return null;
  }
}
