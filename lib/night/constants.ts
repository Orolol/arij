import type { TicketExecutionStatus } from "@/lib/dependencies/scheduler";
import type { WaveFailurePolicy } from "@/lib/dependencies/wave-runner";

/**
 * Client-safe constants and shared response types for night runs (unattended
 * DAG wave builds where every epic runs the full autonomous pipeline).
 *
 * Kept free of any database / server import so client components (the Night
 * Run dialog, summary dialog, settings page) can import setting keys, parsers
 * and the GET route response shapes without pulling server modules into the
 * bundle — same pattern as lib/pipeline/constants.ts. The type-only imports
 * above are erased at compile time.
 */

/* ------------------------------------------------------------------ */
/* Run identity                                                        */
/* ------------------------------------------------------------------ */

/**
 * Prefix of every night-run id (`agent_sessions.batch_run_id` tag). Lets the
 * DB-derived morning summary find night runs after a restart wiped the
 * in-memory registries.
 */
export const NIGHT_RUN_ID_PREFIX = "night_";

/** True when the given batch run id belongs to a night run. */
export function isNightRunId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(NIGHT_RUN_ID_PREFIX);
}

/* ------------------------------------------------------------------ */
/* Stop control                                                        */
/* ------------------------------------------------------------------ */

/**
 * Abort reason the engine returns when the user stopped the run (POST
 * .../night-runs/[runId]/stop). Written verbatim into the run's
 * `abortReason` and into every remaining epic's skip reason, so the server
 * notification title, the summary dialog banner and the tests all classify
 * the same string. Deliberately identical to the wording a user-cancelled
 * pipeline maps to (`mapPipelineTerminalToWaveTicket`).
 */
export const NIGHT_STOPPED_ABORT_REASON = "stopped by user";

/* ------------------------------------------------------------------ */
/* Settings keys                                                       */
/* ------------------------------------------------------------------ */

/**
 * Global settings key: consecutive epic-level pipeline failures a night run
 * tolerates before the circuit breaker aborts the remaining waves.
 * 0 disables the breaker.
 */
export const NIGHT_CIRCUIT_BREAKER_SETTING_KEY = "night_circuit_breaker";

/** Per-project override (`night_circuit_breaker:<projectId>`). */
export function nightCircuitBreakerSettingKey(projectId: string): string {
  return `${NIGHT_CIRCUIT_BREAKER_SETTING_KEY}:${projectId}`;
}

/**
 * Global settings key: total Claude-reported USD a night run may spend before
 * the cost cap aborts the remaining waves. Absent/invalid = unlimited.
 */
export const NIGHT_COST_CAP_SETTING_KEY = "night_cost_cap_usd";

/** Per-project override (`night_cost_cap_usd:<projectId>`). */
export function nightCostCapSettingKey(projectId: string): string {
  return `${NIGHT_COST_CAP_SETTING_KEY}:${projectId}`;
}

/* ------------------------------------------------------------------ */
/* Defaults, clamps, parsing                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_NIGHT_CIRCUIT_BREAKER = 3;

/** Inclusive clamp for the breaker threshold; 0 = disabled. */
export const NIGHT_CIRCUIT_BREAKER_RANGE = { min: 0, max: 10 } as const;

function coerceNumber(value: unknown): number | null {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // raw (non-JSON) string — fall through to numeric coercion
    }
  }
  const num =
    typeof parsed === "number"
      ? parsed
      : typeof parsed === "string" && parsed.trim() !== ""
        ? Number(parsed)
        : NaN;
  return Number.isFinite(num) ? (num as number) : null;
}

/**
 * Parses + clamps the breaker threshold (0..10, 0 = disabled). Returns null
 * when the value is not an integer at all, so callers fall through to the
 * next key of the request → project → global → default chain.
 */
export function parseNightCircuitBreaker(value: unknown): number | null {
  const num = coerceNumber(value);
  if (num === null || !Number.isInteger(num)) return null;
  return Math.min(
    NIGHT_CIRCUIT_BREAKER_RANGE.max,
    Math.max(NIGHT_CIRCUIT_BREAKER_RANGE.min, num)
  );
}

/**
 * Parses the cost cap: a finite number > 0, else null (= unlimited / not
 * configured — an empty input means "no cap").
 */
export function parseNightCostCap(value: unknown): number | null {
  const num = coerceNumber(value);
  if (num === null || num <= 0) return null;
  return num;
}

/* ------------------------------------------------------------------ */
/* GET route response shapes (frozen cross-builder interface)          */
/* ------------------------------------------------------------------ */

/** One epic of a night run, as served by GET /build/night-runs/[runId]. */
export interface NightRunEpicEntry {
  epicId: string;
  readableId: string | null;
  title: string | null;
  status: TicketExecutionStatus;
  /** Failure/skip reason (skip reasons verbatim, incl. abort reasons). */
  reason: string | null;
  /** Pipeline run driving this epic; null pre-launch or after a restart. */
  pipelineRunId: string | null;
  /** Sessions tagged with the run that belong to this epic, dispatch order. */
  sessionIds: string[];
  /** Claude-reported cost of those sessions; null when none reported. */
  costUsd: number | null;
}

/** Full night-run detail, served by GET /build/night-runs/[runId]. */
export interface NightRunDetail {
  runId: string;
  projectId: string;
  /** "registry" = live snapshot; "db" = re-derived from tagged sessions. */
  source: "registry" | "db";
  /** True when the run died with a server restart (db-derived only). */
  interrupted: boolean;
  state: "running" | "finished";
  startedAt: string;
  endedAt: string | null;
  failurePolicy: WaveFailurePolicy | null;
  totalWaves: number | null;
  currentWave: number | null;
  counts: Record<TicketExecutionStatus, number>;
  epics: NightRunEpicEntry[];
  /**
   * True while a live run carries the user's stop request but has not
   * closed yet (the current wave is still settling). Always false for
   * DB-derived runs — the flag died with the process.
   */
  stopRequested: boolean;
  /** SUM of Claude-reported session costs; lower bound (see costIsPartial). */
  totalCostUsd: number;
  /** True when at least one tagged session reported no cost (other providers). */
  costIsPartial: boolean;
  abortReason: string | null;
  abortedAtWave: number | null;
  breakerThreshold: number | null;
  costCapUsd: number | null;
}

/** Compact list entry, served by GET /build/night-runs. */
export type NightRunListEntry = Pick<
  NightRunDetail,
  | "runId"
  | "projectId"
  | "source"
  | "interrupted"
  | "state"
  | "startedAt"
  | "endedAt"
  | "counts"
  | "totalCostUsd"
  | "abortReason"
>;
