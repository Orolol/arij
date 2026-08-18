import type { TicketExecutionStatus } from "@/lib/dependencies/scheduler";
import type { WaveFailurePolicy } from "@/lib/dependencies/wave-runner";

/**
 * In-process registry of night runs, modeled on PipelineRegistry.
 *
 * State lives in memory only — no night_runs table. A run orphaned by a
 * server restart loses its snapshot with the process; the morning story is
 * then re-derived from the database by run id (agent_sessions.batch_run_id,
 * see lib/night/summary.ts) and flagged `interrupted`. Terminal runs move
 * from the active map into a per-project ring of the most recent snapshots
 * so the summary dialog can show last night's outcome without a restart
 * penalty.
 */

/** Terminal snapshots kept per project (newest first). */
export const NIGHT_RECENT_RUNS_LIMIT = 10;

/** Live per-epic state of a night run. */
export interface NightRunEpicState {
  epicId: string;
  /** Pipeline run driving this epic; null until its wave launches it. */
  pipelineRunId: string | null;
  status: TicketExecutionStatus;
  /** Failure/skip reason (from the plan's failureReasons), else null. */
  reason: string | null;
}

export interface NightRunSnapshot {
  runId: string;
  projectId: string;
  failurePolicy: WaveFailurePolicy;
  /** Effective breaker threshold (0 = disabled). */
  breakerThreshold: number;
  /** Effective cost cap in USD; null = unlimited. */
  costCapUsd: number | null;
  state: "running" | "finished";
  startedAt: string;
  endedAt: string | null;
  /** 1-based wave currently executing (0 until the first wave starts). */
  currentWave: number;
  totalWaves: number;
  totalEpics: number;
  counts: Record<TicketExecutionStatus, number>;
  epics: NightRunEpicState[];
  /**
   * True once the user asked for the run to stop (POST .../stop). The engine
   * polls it through `shouldAbortRun` at the wave boundary — same semantics
   * as a breaker trip: no wave launches after it, in-flight pipelines settle
   * naturally, remaining epics are skipped.
   */
  stopRequested: boolean;
  abortReason: string | null;
  abortedAtWave: number | null;
}

function cloneSnapshot(run: NightRunSnapshot): NightRunSnapshot {
  return {
    ...run,
    counts: { ...run.counts },
    epics: run.epics.map((epic) => ({ ...epic })),
  };
}

export type NightRunPatch = Partial<
  Pick<
    NightRunSnapshot,
    "currentWave" | "counts" | "abortReason" | "abortedAtWave"
  >
>;

export class NightRunRegistry {
  /** runId → live snapshot for runs that have not finished. */
  private readonly active = new Map<string, NightRunSnapshot>();
  /** projectId → terminal snapshots, newest first, capped at the ring size. */
  private readonly recent = new Map<string, NightRunSnapshot[]>();

  /** Registers a new run (stored as a defensive copy). */
  register(run: NightRunSnapshot): NightRunSnapshot {
    const snapshot = cloneSnapshot(run);
    this.active.set(snapshot.runId, snapshot);
    return cloneSnapshot(snapshot);
  }

  /** Applies a partial update to an active run (no-op when unknown/finished). */
  update(runId: string, patch: NightRunPatch): void {
    const run = this.active.get(runId);
    if (!run) return;
    if (patch.counts) run.counts = { ...patch.counts };
    if (patch.currentWave !== undefined) run.currentWave = patch.currentWave;
    if (patch.abortReason !== undefined) run.abortReason = patch.abortReason;
    if (patch.abortedAtWave !== undefined) {
      run.abortedAtWave = patch.abortedAtWave;
    }
  }

  /** Patches one epic of an active run (no-op when unknown). */
  updateEpic(
    runId: string,
    epicId: string,
    patch: Partial<Omit<NightRunEpicState, "epicId">>
  ): void {
    const run = this.active.get(runId);
    if (!run) return;
    const epic = run.epics.find((entry) => entry.epicId === epicId);
    if (!epic) return;
    Object.assign(epic, patch);
  }

  /**
   * Flags an ACTIVE run as stop-requested. Returns false when the run is
   * unknown or already finished (the route turns that into a 404); true when
   * the flag is set — including a repeat request, so stopping is idempotent.
   */
  requestStop(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    run.stopRequested = true;
    return true;
  }

  /** True while an active run carries the user's stop request. */
  isStopRequested(runId: string): boolean {
    return this.active.get(runId)?.stopRequested === true;
  }

  /**
   * Moves a run from the active map into its project's recent ring with
   * state "finished" stamped. Idempotent: finishing an unknown run is a
   * no-op (e.g. the crash safety net finishing after the callback already
   * did).
   */
  finish(runId: string, endedAt: string = new Date().toISOString()): void {
    const run = this.active.get(runId);
    if (!run) return;
    this.active.delete(runId);

    run.state = "finished";
    run.endedAt = endedAt;

    const ring = this.recent.get(run.projectId) ?? [];
    ring.unshift(run);
    if (ring.length > NIGHT_RECENT_RUNS_LIMIT) {
      ring.length = NIGHT_RECENT_RUNS_LIMIT;
    }
    this.recent.set(run.projectId, ring);
  }

  /** One run by id (active first, then the recent rings). */
  get(runId: string): NightRunSnapshot | null {
    const active = this.active.get(runId);
    if (active) return cloneSnapshot(active);
    for (const ring of this.recent.values()) {
      const found = ring.find((run) => run.runId === runId);
      if (found) return cloneSnapshot(found);
    }
    return null;
  }

  /** The project's active run, if any (at most one by the route guard). */
  getActiveByProject(projectId: string): NightRunSnapshot | null {
    for (const run of this.active.values()) {
      if (run.projectId === projectId) return cloneSnapshot(run);
    }
    return null;
  }

  /**
   * Active runs (newest first) followed by the project's recent terminal
   * snapshots (newest first). Every entry is a defensive copy.
   */
  listByProject(projectId: string): NightRunSnapshot[] {
    const active = Array.from(this.active.values())
      .filter((run) => run.projectId === projectId)
      .reverse()
      .map(cloneSnapshot);
    const recent = (this.recent.get(projectId) ?? []).map(cloneSnapshot);
    return [...active, ...recent];
  }
}

/**
 * globalThis-backed singleton (scheduler/watchdog/DAG-registry pattern): a
 * dev hot reload re-evaluates module scope, and a background night run
 * writing to a stale instance while GET night-runs reads a fresh empty one
 * would make active runs invisible.
 */
const NIGHT_REGISTRY_GLOBAL_KEY = Symbol.for("arij.night-run-registry");

function getNightRunRegistry(): NightRunRegistry {
  const store = globalThis as {
    [NIGHT_REGISTRY_GLOBAL_KEY]?: NightRunRegistry;
  };
  if (!store[NIGHT_REGISTRY_GLOBAL_KEY]) {
    store[NIGHT_REGISTRY_GLOBAL_KEY] = new NightRunRegistry();
  }
  return store[NIGHT_REGISTRY_GLOBAL_KEY];
}

/** Singleton instance (class exported for isolated unit tests). */
export const nightRunRegistry = getNightRunRegistry();
