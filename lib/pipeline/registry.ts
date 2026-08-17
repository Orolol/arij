import type {
  PipelineRunSnapshot,
  PipelineStage,
  PipelineState,
} from "./constants";

/**
 * In-process registry of pipeline runs, modeled on DagBatchRegistry.
 *
 * State lives in memory only — NO pipeline_runs table, no migration.
 * Restart survivability is already covered by the existing boot sweeps: a
 * run orphaned by a restart loses its live session to
 * cancelOrphanedQueuedSessions / failOrphanedRunningSessions ('orphaned by
 * restart'), and the per-stage ticketActivityLog trail documents how far it
 * got. The registry itself simply disappears with the process.
 *
 * Unlike the DAG registry, terminal runs are not dropped immediately:
 * `finish()` moves the run from the active map into a per-project ring of
 * the most recent terminal snapshots (no timers) so the UI can show recent
 * outcomes next to the active runs.
 */

/** Terminal snapshots kept per project (newest first). */
export const PIPELINE_RECENT_RUNS_LIMIT = 20;

function cloneSnapshot(run: PipelineRunSnapshot): PipelineRunSnapshot {
  return { ...run, sessionIds: [...run.sessionIds] };
}

export type PipelineRunPatch = Partial<
  Pick<
    PipelineRunSnapshot,
    "state" | "stage" | "stageAttempt" | "fixCycles" | "reason"
  >
>;

export class PipelineRegistry {
  /** runId → live snapshot for runs that have not reached a terminal state. */
  private readonly active = new Map<string, PipelineRunSnapshot>();
  /** projectId → terminal snapshots, newest first, capped at the ring size. */
  private readonly recent = new Map<string, PipelineRunSnapshot[]>();

  /** Registers a new run (stored as a defensive copy). */
  register(run: PipelineRunSnapshot): PipelineRunSnapshot {
    const snapshot = cloneSnapshot(run);
    this.active.set(snapshot.runId, snapshot);
    return cloneSnapshot(snapshot);
  }

  /** Applies a partial update to an active run (no-op when unknown/terminal). */
  update(runId: string, patch: PipelineRunPatch): void {
    const run = this.active.get(runId);
    if (!run) return;
    Object.assign(run, patch);
  }

  /** Appends a session id to an active run (idempotent). */
  recordSession(runId: string, sessionId: string): void {
    const run = this.active.get(runId);
    if (!run) return;
    if (!run.sessionIds.includes(sessionId)) {
      run.sessionIds.push(sessionId);
    }
  }

  /**
   * Moves a run from the active map into its project's recent ring with the
   * terminal state/reason stamped. Idempotent: finishing an unknown run is a
   * no-op (e.g. a crashed engine finishing after the callback already did).
   */
  finish(
    runId: string,
    state: PipelineState,
    reason: string | null,
    endedAt: string = new Date().toISOString()
  ): void {
    const run = this.active.get(runId);
    if (!run) return;
    this.active.delete(runId);

    run.state = state;
    run.reason = reason;
    run.endedAt = endedAt;

    const ring = this.recent.get(run.projectId) ?? [];
    ring.unshift(run);
    if (ring.length > PIPELINE_RECENT_RUNS_LIMIT) {
      ring.length = PIPELINE_RECENT_RUNS_LIMIT;
    }
    this.recent.set(run.projectId, ring);
  }

  /** One run by id (active first, then the recent rings). */
  get(runId: string): PipelineRunSnapshot | null {
    const active = this.active.get(runId);
    if (active) return cloneSnapshot(active);
    for (const ring of this.recent.values()) {
      const found = ring.find((run) => run.runId === runId);
      if (found) return cloneSnapshot(found);
    }
    return null;
  }

  /**
   * Active runs (newest first) followed by the project's recent terminal
   * snapshots (newest first). Every entry is a defensive copy.
   */
  listByProject(projectId: string): PipelineRunSnapshot[] {
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
 * dev hot reload re-evaluates module scope, and a background pipeline run
 * writing to a stale instance while GET pipeline/runs reads a fresh empty
 * one would make active runs invisible.
 */
const PIPELINE_REGISTRY_GLOBAL_KEY = Symbol.for("arij.pipeline-registry");

function getPipelineRegistry(): PipelineRegistry {
  const store = globalThis as {
    [PIPELINE_REGISTRY_GLOBAL_KEY]?: PipelineRegistry;
  };
  if (!store[PIPELINE_REGISTRY_GLOBAL_KEY]) {
    store[PIPELINE_REGISTRY_GLOBAL_KEY] = new PipelineRegistry();
  }
  return store[PIPELINE_REGISTRY_GLOBAL_KEY];
}

/** Singleton instance (class exported for isolated unit tests). */
export const pipelineRegistry = getPipelineRegistry();

/**
 * Read API for GET /api/projects/[projectId]/pipeline/runs: active runs
 * plus the recent terminal ring.
 */
export function listPipelineRunsByProject(
  projectId: string
): PipelineRunSnapshot[] {
  return pipelineRegistry.listByProject(projectId);
}

export type { PipelineRunSnapshot, PipelineStage, PipelineState };
