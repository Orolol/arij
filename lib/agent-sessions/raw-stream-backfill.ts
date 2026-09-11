/**
 * One-shot trim of the session history written before the write-path caps.
 *
 * Two columns are capped on the way in and nothing else bounds what predates
 * the caps:
 *   - the raw stream (`SESSION_RAW_STREAM_MAX_BYTES` in `appendChunk`), which
 *     fires on an append, so it never reaches a session that stopped writing
 *     before it shipped. Measured on the live database on 2026-09-10: ~780 MB
 *     of raw content, 35 sessions over 5 MB holding 90 % of it;
 *   - `agent_sessions.prompt` (`capSessionPrompt`): 38 rows over the 128 KiB
 *     cap on 2026-09-11, 27.0 MB between them.
 * The only other purge, the `retention` routine, is opt-in per project and was
 * never enabled anywhere (0 routines on the live database), so neither backlog
 * had an execution path. The volume is treated where it was produced: this
 * pass brings the history to the state the write paths would have left it in,
 * through the write paths' own cuts (`trimRawStream`, and `capSessionPrompt`
 * via the retention routine's `createSessionPromptBackfiller`).
 *
 * Shape of the pass, in order:
 *   1. Skip the walk once `raw_stream_backfill_trimmed_at` is set: after one
 *      complete pass the write paths keep every row under its cap alone.
 *   2. Walk the raw streams in small batches, yielding to the event loop
 *      between batches and after every trimmed session — better-sqlite3 is
 *      synchronous on the one connection every request shares. Sessions are
 *      pre-weighed from record headers, so the ones already under the cap
 *      cost next to nothing and never take the write lock.
 *   3. Cap the over-limit prompts, a few rows per call, project by project.
 *   4. The first refusal from the database (busy/locked) ends the run,
 *      UNMARKED, so the next boot finishes it. The shared connection's busy
 *      wait is lowered for the pass (`withBusyTimeout`), so a foreign lock
 *      costs one short wait instead of the default 5 s per statement.
 *   5. Mark completion, and — when rows went or the free list is large — a
 *      second mark, `raw_stream_backfill_vacuum_due_at`: the VACUUM is owed.
 *   6. Settle that debt at a quiet moment, not at boot: the rewrite is a
 *      multi-second exclusive lock, and boot is exactly when Full Auto Mode
 *      restarts sessions. The debt is cleared BEFORE the rewrite (the
 *      retention routine's order, and for its reason: a crash mid-VACUUM
 *      must not hand the next boot a second one) and restored if the VACUUM
 *      fails, so a busy database is retried by a later boot rather than
 *      abandoned. The rewrite itself is the retention routine's
 *      (`defaultRetentionDeps.vacuum`), not a copy.
 *
 * No routine is seeded: this runs once per database, from `instrumentation.ts`,
 * off the boot path.
 */

import { eq, inArray } from "drizzle-orm";
import { db, sqlite } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  isDatabaseBusyError,
  trimRawStreamsOverCap,
  type RawStreamsOverCapOptions,
  type RawStreamsOverCapResult,
} from "@/lib/agent-sessions/chunks";
import { createSessionPromptBackfiller } from "@/lib/agent-sessions/prompt-backfill";
import { SESSION_PROMPT_MAX_STORED_BYTES } from "@/lib/agent-sessions/prompt-cap";
import { defaultRetentionDeps } from "@/lib/routines/retention";

/** Server-managed: when the one complete pass finished. */
export const RAW_STREAM_BACKFILL_SETTING_KEY = "raw_stream_backfill_trimmed_at";

/**
 * Server-managed: set when the completed pass owes the database one VACUUM,
 * cleared by the run that takes it.
 */
export const RAW_STREAM_BACKFILL_VACUUM_DUE_SETTING_KEY =
  "raw_stream_backfill_vacuum_due_at";

/**
 * Sessions weighed between two yields to the event loop. The weigh reads
 * record headers only (1.6 ms for the heaviest, 112 MB stream; 85 ms for all
 * 310 sessions of the live database), so the batch stays short even cold;
 * the trims, which are the heavy part, yield one by one. Measured on a copy
 * of the live database (tmpfs, warm): 310 sessions in 57 calls, 37 trimmed,
 * 678 MiB dropped, longest call 145 ms — the trim of one 112 MB stream,
 * which is a single transaction by design.
 */
export const RAW_STREAM_BACKFILL_BATCH_SESSIONS = 8;

/**
 * Prompts rewritten between two yields. Each is up to a few MB, read and
 * rewritten whole, and every call re-selects its project's over-cap rows.
 * Measured on a copy of the live database: 38 rows in 20 calls, longest
 * 81 ms, against 134 ms at 8 rows a call.
 */
export const RAW_STREAM_BACKFILL_PROMPT_BATCH_ROWS = 2;

/**
 * Busy wait of the shared connection while the pass holds it. The default is
 * better-sqlite3's 5 s, paid synchronously on the event loop; the pass would
 * rather give up and retry at the next boot than freeze requests for that.
 */
export const RAW_STREAM_BACKFILL_BUSY_TIMEOUT_MS = 250;

/**
 * Free-list size that earns the VACUUM on a run that itself dropped nothing.
 * That run is the one that completes a pass an earlier boot left half done
 * (a refused lock, a crash): the earlier boot deleted rows and, being
 * incomplete, recorded no debt — so the debt is measured on the file.
 */
export const RAW_STREAM_BACKFILL_VACUUM_MIN_FREE_BYTES = 16 * 1024 * 1024;

/**
 * Interval between two looks for a quiet moment to VACUUM in. The debt is
 * only settled after a full interval has passed AND no session is active, so
 * the rewrite never lands in the burst of work that follows a boot.
 */
export const RAW_STREAM_BACKFILL_VACUUM_QUIET_POLL_MS = 60_000;

export interface RawStreamBackfillMarks {
  trimmedAt: string | null;
  vacuumDueAt: string | null;
}

export interface PromptCapBatchResult {
  /** The project this call worked on; `null` when no prompt is over the cap. */
  projectId: string | null;
  cappedPrompts: number;
  reclaimedBytes: number;
  /** True when this project still has over-cap prompts left for another call. */
  reachedRowBudget: boolean;
}

export interface RawStreamBackfillDeps {
  readMarks(): RawStreamBackfillMarks;
  /** One write; `null` clears a mark, an absent field leaves it alone. */
  writeMarks(patch: Partial<RawStreamBackfillMarks>): void;
  trimBatch(options: RawStreamsOverCapOptions): RawStreamsOverCapResult;
  /** Caps the next project's over-limit prompts, projects in id order. */
  capPromptBatch(options: {
    afterProjectId: string | null;
    maxRows: number;
  }): PromptCapBatchResult;
  vacuum(): void;
  /** Bytes on SQLite's free list — what a VACUUM would give back. */
  reclaimableBytes(): number;
  /** True when no agent session is running or waiting to start. */
  isQuiet(): boolean;
  /** Hands the event loop back between batches. */
  pause(): Promise<void>;
  /** Waits between two looks for a quiet moment. */
  wait(ms: number): Promise<void>;
  info(message: string): void;
  warn(message: string): void;
}

export interface RawStreamBackfillResult {
  /**
   * `already-done`: a previous boot completed the pass. `completed`: this run
   * walked everything and set the mark. `incomplete`: something was refused
   * or failed; the mark is unset and the next boot runs again.
   */
  status: "already-done" | "completed" | "incomplete";
  scannedSessions: number;
  trimmedSessions: number;
  droppedChunks: number;
  droppedBytes: number;
  lockedSessions: number;
  cappedPrompts: number;
  promptBytesReclaimed: number;
  /** True when this run took the owed VACUUM. */
  vacuumed: boolean;
  /** True when a VACUUM is still owed after this run (a later boot settles it). */
  vacuumDue: boolean;
}

/**
 * Run `fn` with the connection's busy wait lowered to `ms`, restoring it
 * afterwards, even on a throw. Safe on the shared handle only because `fn`
 * is synchronous: no other request's statement can run while the lowered
 * value is in force.
 */
export function withBusyTimeout<T>(
  database: { pragma(source: string, options?: { simple?: boolean }): unknown },
  ms: number,
  fn: () => T
): T {
  const previous = Number(database.pragma("busy_timeout", { simple: true }));
  database.pragma(`busy_timeout = ${Math.max(0, Math.floor(ms))}`);
  try {
    return fn();
  } finally {
    database.pragma(`busy_timeout = ${previous}`);
  }
}

const bounded = <T>(fn: () => T): T =>
  withBusyTimeout(sqlite, RAW_STREAM_BACKFILL_BUSY_TIMEOUT_MS, fn);

function readMarkValue(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

export const defaultRawStreamBackfillDeps: RawStreamBackfillDeps = {
  readMarks() {
    const rows = db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(
        inArray(settings.key, [
          RAW_STREAM_BACKFILL_SETTING_KEY,
          RAW_STREAM_BACKFILL_VACUUM_DUE_SETTING_KEY,
        ])
      )
      .all();
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      trimmedAt: readMarkValue(byKey.get(RAW_STREAM_BACKFILL_SETTING_KEY)),
      vacuumDueAt: readMarkValue(
        byKey.get(RAW_STREAM_BACKFILL_VACUUM_DUE_SETTING_KEY)
      ),
    };
  },
  writeMarks(patch) {
    const entries: Array<[string, string | null]> = [];
    if (patch.trimmedAt !== undefined) {
      entries.push([RAW_STREAM_BACKFILL_SETTING_KEY, patch.trimmedAt]);
    }
    if (patch.vacuumDueAt !== undefined) {
      entries.push([RAW_STREAM_BACKFILL_VACUUM_DUE_SETTING_KEY, patch.vacuumDueAt]);
    }
    const updatedAt = new Date().toISOString();
    bounded(() =>
      db.transaction((tx) => {
        for (const [key, at] of entries) {
          if (at === null) {
            tx.delete(settings).where(eq(settings.key, key)).run();
            continue;
          }
          // `settings.value` holds JSON, like every other key.
          const value = JSON.stringify(at);
          tx.insert(settings)
            .values({ key, value, updatedAt })
            .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
            .run();
        }
      })
    );
  },
  trimBatch: (options) => bounded(() => trimRawStreamsOverCap(options)),
  capPromptBatch({ afterProjectId, maxRows }) {
    return bounded(() => {
      // Candidate projects from record headers only (`octet_length` never
      // loads a prompt; in a UTF-8 database it is the byte length the cap is
      // expressed in). The retention routine's backfiller then selects and
      // cuts with its own predicate, so a candidate it disagrees with just
      // caps nothing and the walk moves on.
      const next = sqlite
        .prepare(
          `SELECT project_id AS projectId FROM agent_sessions
            WHERE project_id > ? AND octet_length(prompt) > ?
            ORDER BY project_id LIMIT 1`
        )
        .get(afterProjectId ?? "", SESSION_PROMPT_MAX_STORED_BYTES) as
        | { projectId: string }
        | undefined;
      if (!next) {
        return { projectId: null, cappedPrompts: 0, reclaimedBytes: 0, reachedRowBudget: false };
      }
      const capped = createSessionPromptBackfiller(sqlite).backfill({
        projectId: next.projectId,
        maxRows,
      });
      return {
        projectId: next.projectId,
        cappedPrompts: capped.cappedPrompts,
        reclaimedBytes: capped.reclaimedBytes,
        reachedRowBudget: capped.reachedRowBudget,
      };
    });
  },
  // The retention routine's rewrite — raw handle, outside any transaction —
  // is the one place Arij runs VACUUM; reused rather than restated.
  vacuum: () => bounded(() => defaultRetentionDeps.vacuum()),
  reclaimableBytes() {
    const pages = sqlite.pragma("freelist_count", { simple: true });
    const pageSize = sqlite.pragma("page_size", { simple: true });
    return Number(pages) * Number(pageSize);
  },
  isQuiet() {
    // Agent sessions are the long writers and the reason a boot is busy
    // (Full Auto Mode refills its slots). A request that lands during the
    // rewrite still waits on it; the aim is to stay out of the sessions'
    // bursts, which is where a multi-second stall hurts.
    const active = sqlite
      .prepare(
        `SELECT 1 FROM agent_sessions
          WHERE status IN ('running', 'queued', 'pending') LIMIT 1`
      )
      .get();
    return active === undefined;
  },
  pause: () => new Promise((resolve) => setImmediate(resolve)),
  wait: (ms) =>
    new Promise((resolve) => {
      // Never what keeps a stopping process alive.
      setTimeout(resolve, ms).unref();
    }),
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
};

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KiB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MiB`;
}

function describeError(error: unknown): string {
  if (isDatabaseBusyError(error)) return "the database was busy";
  return error instanceof Error ? error.message : String(error);
}

const LOG_PREFIX = "[raw-stream-backfill]";

function summarize(result: RawStreamBackfillResult): string {
  return (
    `${result.trimmedSessions} of ${result.scannedSessions} sessions trimmed, ` +
    `${result.droppedChunks} raw rows / ${formatSize(result.droppedBytes)} dropped, ` +
    `${result.cappedPrompts} prompts capped / ${formatSize(result.promptBytesReclaimed)} freed`
  );
}

/**
 * Walk the raw streams, then the prompts. Returns false when the run must be
 * left unmarked (refused or failed), having logged why.
 */
async function trimHistory(
  deps: RawStreamBackfillDeps,
  result: RawStreamBackfillResult
): Promise<boolean> {
  try {
    let cursor: string | null = null;
    for (;;) {
      const batch = deps.trimBatch({
        afterSessionId: cursor,
        maxSessions: RAW_STREAM_BACKFILL_BATCH_SESSIONS,
        maxTrimmedSessions: 1,
      });
      result.scannedSessions += batch.scannedSessions;
      result.trimmedSessions += batch.trimmedSessions;
      result.droppedChunks += batch.droppedChunks;
      result.droppedBytes += batch.droppedBytes;
      result.lockedSessions += batch.lockedSessions;
      cursor = batch.lastSessionId;
      if (batch.lockedSessions > 0) {
        deps.warn(
          `${LOG_PREFIX} ${summarize(result)}; the database refused the write lock (locked), will resume next boot.`
        );
        return false;
      }
      if (batch.done || batch.scannedSessions === 0) break;
      await deps.pause();
    }

    let project: string | null = null;
    for (;;) {
      const batch = deps.capPromptBatch({
        afterProjectId: project,
        maxRows: RAW_STREAM_BACKFILL_PROMPT_BATCH_ROWS,
      });
      if (batch.projectId === null) break;
      result.cappedPrompts += batch.cappedPrompts;
      result.promptBytesReclaimed += batch.reclaimedBytes;
      // The same project again while it still has rows over the cap.
      if (!batch.reachedRowBudget) project = batch.projectId;
      await deps.pause();
    }
  } catch (error) {
    // Rows already trimmed stay trimmed — each session and each prompt
    // committed on its own — and the next boot's walk skips them as under
    // the cap.
    deps.warn(
      `${LOG_PREFIX} stopped: ${summarize(result)} so far, will resume next boot: ${describeError(error)}`
    );
    return false;
  }
  return true;
}

/**
 * Take the owed VACUUM once no session is active. Resolves when it is taken,
 * when it fails (the debt is put back for a later boot), or never, if this
 * process never finds a quiet moment — the debt then carries over as is.
 */
async function settleVacuum(
  deps: RawStreamBackfillDeps,
  result: RawStreamBackfillResult,
  dueAt: string
): Promise<void> {
  for (;;) {
    await deps.wait(RAW_STREAM_BACKFILL_VACUUM_QUIET_POLL_MS);
    let quiet: boolean;
    try {
      quiet = deps.isQuiet();
    } catch (error) {
      deps.warn(
        `${LOG_PREFIX} could not tell whether sessions are running, VACUUM left for a later boot: ${describeError(error)}`
      );
      return;
    }
    if (quiet) break;
  }

  try {
    // Claim before the rewrite (see the module note).
    deps.writeMarks({ vacuumDueAt: null });
  } catch (error) {
    deps.warn(`${LOG_PREFIX} could not claim the VACUUM, left for a later boot: ${describeError(error)}`);
    return;
  }
  try {
    deps.vacuum();
  } catch (error) {
    const reason = describeError(error);
    try {
      deps.writeMarks({ vacuumDueAt: dueAt });
    } catch {
      result.vacuumDue = false;
      deps.warn(
        `${LOG_PREFIX} VACUUM failed (${reason}). The pages stay on SQLite's free list — ` +
          `reclaim them by hand against a stopped server: sqlite3 data/arij.db 'VACUUM;'`
      );
      return;
    }
    deps.warn(`${LOG_PREFIX} VACUUM failed (${reason}); a later boot will retry it.`);
    return;
  }
  result.vacuumed = true;
  result.vacuumDue = false;
  deps.info(`${LOG_PREFIX} database vacuumed.`);
}

/**
 * Run the pass. Never throws: every failure is logged and reported, because
 * this runs unattended at boot and a failure here must cost nothing but the
 * retry. The promise settles once the owed VACUUM is settled, which may be
 * long after the trim itself (see `settleVacuum`).
 */
export async function runRawStreamBackfill(
  deps: RawStreamBackfillDeps = defaultRawStreamBackfillDeps,
  now: () => Date = () => new Date()
): Promise<RawStreamBackfillResult> {
  const result: RawStreamBackfillResult = {
    status: "incomplete",
    scannedSessions: 0,
    trimmedSessions: 0,
    droppedChunks: 0,
    droppedBytes: 0,
    lockedSessions: 0,
    cappedPrompts: 0,
    promptBytesReclaimed: 0,
    vacuumed: false,
    vacuumDue: false,
  };

  let marks: RawStreamBackfillMarks;
  try {
    marks = deps.readMarks();
  } catch (error) {
    deps.warn(`${LOG_PREFIX} could not read its marks, will retry next boot: ${describeError(error)}`);
    return result;
  }

  let dueAt = marks.vacuumDueAt;
  if (marks.trimmedAt !== null) {
    result.status = "already-done";
  } else {
    if (!(await trimHistory(deps, result))) return result;

    let reclaimable = 0;
    try {
      reclaimable = deps.reclaimableBytes();
    } catch {
      // Unknown free list: only this run's own deletions decide.
    }
    const owed =
      result.droppedChunks > 0 ||
      result.cappedPrompts > 0 ||
      reclaimable >= RAW_STREAM_BACKFILL_VACUUM_MIN_FREE_BYTES;
    const at = now().toISOString();
    try {
      deps.writeMarks(owed ? { trimmedAt: at, vacuumDueAt: at } : { trimmedAt: at });
    } catch (error) {
      deps.warn(
        `${LOG_PREFIX} ${summarize(result)}; could not record completion, will re-check next boot: ${describeError(error)}`
      );
      return result;
    }
    result.status = "completed";
    if (owed) dueAt = at;
    deps.info(
      `${LOG_PREFIX} ${summarize(result)}; ${
        owed ? "VACUUM deferred to the first quiet moment." : "nothing to reclaim."
      }`
    );
  }

  if (dueAt === null) return result;
  result.vacuumDue = true;
  await settleVacuum(deps, result, dueAt);
  return result;
}

const SCHEDULED = Symbol.for("arij.rawStreamBackfill.scheduled");

/**
 * Fire-and-forget entry point for `instrumentation.ts`. Deferred to the next
 * macrotask so it never delays the boot, and guarded on `globalThis` so a dev
 * hot reload — which re-runs instrumentation — cannot start a second walk.
 */
export function scheduleRawStreamBackfill(
  deps: RawStreamBackfillDeps = defaultRawStreamBackfillDeps
): void {
  const scope = globalThis as { [SCHEDULED]?: boolean };
  if (scope[SCHEDULED]) return;
  scope[SCHEDULED] = true;
  setImmediate(() => {
    void runRawStreamBackfill(deps).catch((error: unknown) => {
      deps.warn(`${LOG_PREFIX} crashed: ${describeError(error)}`);
    });
  });
}
