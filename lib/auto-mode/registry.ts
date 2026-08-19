import { AUTO_MODE_MAX_CONSECUTIVE_FAILURES } from "./constants";

/**
 * In-process state of Full Auto Mode, modeled on NightRunRegistry.
 *
 * There is deliberately NO table: the mode's *configuration* is durable (the
 * five `settings` keys) but its *runtime* state is not. A server restart
 * therefore resumes the mode from settings with an empty in-flight set,
 * which is exactly right — the sessions it was tracking died with the
 * process and boot cleanup cancels/fails their rows like any other orphan.
 *
 * The registry answers four questions for the sweep:
 *   1. how many builds / reviews of MY OWN dispatch are still in flight
 *      (admission control — the mode's budgets live above the scheduler's,
 *      so it must count its own work rather than trust the queue);
 *   2. is a sweep for this project already running (per-project mutex, so
 *      the timer tick and a terminal-hook kick can never overlap);
 *   3. is this ticket parked after repeated failures;
 *   4. what did the mode do recently (the dialog's live feed).
 */

/** Recent dispatches kept per project (newest first). */
export const AUTO_MODE_RECENT_LIMIT = 20;

export type AutoModeDispatchKind =
  | "build"
  | "review"
  | "merge"
  | "merge-fix"
  | "skip";

export interface AutoModeDispatchRecord {
  kind: AutoModeDispatchKind;
  epicId: string;
  userStoryId: string | null;
  /** Null for pure-git merges and for dispatches that never got a row. */
  sessionId: string | null;
  detail: string | null;
  at: string;
}

export interface AutoModeParkedTicket {
  /** Story id for story-scoped work, else the epic id. */
  ticketId: string;
  epicId: string;
  failures: number;
  reason: string;
  at: string;
}

export interface AutoModeSnapshot {
  projectId: string;
  enabled: boolean;
  lastSweepAt: string | null;
  inFlight: { build: number; review: number };
  inFlightSessionIds: { build: string[]; review: string[] };
  parked: AutoModeParkedTicket[];
  recentDispatches: AutoModeDispatchRecord[];
}

interface FailureEntry {
  epicId: string;
  failures: number;
  reason: string;
  at: string;
}

/** What one in-flight session of the mode's own dispatch is working on. */
export interface AutoModeInFlightEntry {
  kind: "build" | "review";
  /** Story id for story-scoped work, else the epic id (the parking key). */
  ticketId: string;
  epicId: string;
}

interface AutoModeProjectState {
  enabled: boolean;
  /** sessionId → what it is, for every session the mode has not reconciled. */
  inFlight: Map<string, AutoModeInFlightEntry>;
  lastSweepAt: string | null;
  recent: AutoModeDispatchRecord[];
  /** ticketId → consecutive failure count (parked at the cap). */
  failures: Map<string, FailureEntry>;
  /** Per-project mutex: true while a sweep is in flight. */
  sweeping: boolean;
}

function emptyState(): AutoModeProjectState {
  return {
    enabled: false,
    inFlight: new Map(),
    lastSweepAt: null,
    recent: [],
    failures: new Map(),
    sweeping: false,
  };
}

export class AutoModeRegistry {
  private readonly states = new Map<string, AutoModeProjectState>();

  private stateFor(projectId: string): AutoModeProjectState {
    let state = this.states.get(projectId);
    if (!state) {
      state = emptyState();
      this.states.set(projectId, state);
    }
    return state;
  }

  // ---------------------------------------------------------------------
  // Enablement
  // ---------------------------------------------------------------------

  /**
   * Mirrors the persisted `auto_mode_enabled:<projectId>` setting into the
   * registry. Switching OFF drops every scrap of runtime state so a later
   * re-enable starts clean (in particular: parked tickets get another
   * chance, which is the documented way to un-park).
   */
  setEnabled(projectId: string, enabled: boolean): void {
    if (!enabled) {
      this.states.delete(projectId);
      return;
    }
    this.stateFor(projectId).enabled = true;
  }

  isEnabled(projectId: string): boolean {
    return this.states.get(projectId)?.enabled === true;
  }

  /** Projects the registry currently tracks as enabled. */
  listEnabledProjectIds(): string[] {
    return Array.from(this.states.entries())
      .filter(([, state]) => state.enabled)
      .map(([projectId]) => projectId);
  }

  // ---------------------------------------------------------------------
  // Per-project sweep mutex
  // ---------------------------------------------------------------------

  /** Takes the project's sweep lock. False when a sweep is already running. */
  tryLock(projectId: string): boolean {
    const state = this.stateFor(projectId);
    if (state.sweeping) return false;
    state.sweeping = true;
    return true;
  }

  unlock(projectId: string): void {
    const state = this.states.get(projectId);
    if (state) state.sweeping = false;
  }

  isSweeping(projectId: string): boolean {
    return this.states.get(projectId)?.sweeping === true;
  }

  markSwept(projectId: string, at: string = new Date().toISOString()): void {
    this.stateFor(projectId).lastSweepAt = at;
  }

  // ---------------------------------------------------------------------
  // In-flight accounting (admission control)
  // ---------------------------------------------------------------------

  addInFlight(
    projectId: string,
    sessionId: string,
    entry: AutoModeInFlightEntry
  ): void {
    this.stateFor(projectId).inFlight.set(sessionId, entry);
  }

  /** Drops a session from the in-flight map, returning what it was doing. */
  removeInFlight(
    projectId: string,
    sessionId: string
  ): AutoModeInFlightEntry | null {
    const state = this.states.get(projectId);
    if (!state) return null;
    const entry = state.inFlight.get(sessionId) ?? null;
    state.inFlight.delete(sessionId);
    return entry;
  }

  /** Snapshot of the in-flight map, safe to iterate while mutating it. */
  listInFlight(
    projectId: string
  ): Array<{ sessionId: string; entry: AutoModeInFlightEntry }> {
    const state = this.states.get(projectId);
    if (!state) return [];
    return Array.from(state.inFlight.entries()).map(([sessionId, entry]) => ({
      sessionId,
      entry,
    }));
  }

  countInFlight(projectId: string): { build: number; review: number } {
    const state = this.states.get(projectId);
    let build = 0;
    let review = 0;
    for (const entry of state?.inFlight.values() ?? []) {
      if (entry.kind === "build") build += 1;
      else review += 1;
    }
    return { build, review };
  }

  listInFlightSessionIds(projectId: string): {
    build: string[];
    review: string[];
  } {
    const state = this.states.get(projectId);
    const build: string[] = [];
    const review: string[] = [];
    for (const [sessionId, entry] of state?.inFlight ?? []) {
      (entry.kind === "build" ? build : review).push(sessionId);
    }
    return { build, review };
  }

  /** Every session id the mode is tracking — the driver's `ownSessionIds`. */
  ownSessionIds(projectId: string): string[] {
    return Array.from(this.states.get(projectId)?.inFlight.keys() ?? []);
  }

  // ---------------------------------------------------------------------
  // Parking
  // ---------------------------------------------------------------------

  /**
   * Records one failure for a ticket and returns the new consecutive count.
   * At AUTO_MODE_MAX_CONSECUTIVE_FAILURES the ticket is parked: `isParked`
   * turns true and the selectors drop it until the mode is toggled or the
   * ticket is explicitly cleared.
   */
  recordFailure(
    projectId: string,
    ticketId: string,
    epicId: string,
    reason: string,
    at: string = new Date().toISOString()
  ): number {
    const state = this.stateFor(projectId);
    const previous = state.failures.get(ticketId);
    const failures = (previous?.failures ?? 0) + 1;
    state.failures.set(ticketId, { epicId, failures, reason, at });
    return failures;
  }

  /**
   * Parks a ticket outright, skipping the streak. Used where one more
   * attempt is known to be pointless — a merge conflict that survived the
   * merge-fix agent AND the retry needs a human, not a fourth sweep.
   */
  park(
    projectId: string,
    ticketId: string,
    epicId: string,
    reason: string,
    at: string = new Date().toISOString()
  ): void {
    this.stateFor(projectId).failures.set(ticketId, {
      epicId,
      failures: AUTO_MODE_MAX_CONSECUTIVE_FAILURES,
      reason,
      at,
    });
  }

  /** Forgets a ticket's failure streak (a success, or a manual un-park). */
  clearFailures(projectId: string, ticketId: string): void {
    this.states.get(projectId)?.failures.delete(ticketId);
  }

  isParked(projectId: string, ticketId: string): boolean {
    const entry = this.states.get(projectId)?.failures.get(ticketId);
    return (entry?.failures ?? 0) >= AUTO_MODE_MAX_CONSECUTIVE_FAILURES;
  }

  /** Ticket ids currently parked, for the selectors' exclusion set. */
  parkedTicketIds(projectId: string): Set<string> {
    const state = this.states.get(projectId);
    if (!state) return new Set();
    const parked = new Set<string>();
    for (const [ticketId, entry] of state.failures) {
      if (entry.failures >= AUTO_MODE_MAX_CONSECUTIVE_FAILURES) {
        parked.add(ticketId);
      }
    }
    return parked;
  }

  listParked(projectId: string): AutoModeParkedTicket[] {
    const state = this.states.get(projectId);
    if (!state) return [];
    return Array.from(state.failures.entries())
      .filter(
        ([, entry]) => entry.failures >= AUTO_MODE_MAX_CONSECUTIVE_FAILURES
      )
      .map(([ticketId, entry]) => ({
        ticketId,
        epicId: entry.epicId,
        failures: entry.failures,
        reason: entry.reason,
        at: entry.at,
      }));
  }

  // ---------------------------------------------------------------------
  // Recent-dispatch ring (the dialog's "what is it doing" feed)
  // ---------------------------------------------------------------------

  recordDispatch(
    projectId: string,
    record: Omit<AutoModeDispatchRecord, "at"> & { at?: string }
  ): void {
    const state = this.stateFor(projectId);
    state.recent.unshift({
      ...record,
      at: record.at ?? new Date().toISOString(),
    });
    if (state.recent.length > AUTO_MODE_RECENT_LIMIT) {
      state.recent.length = AUTO_MODE_RECENT_LIMIT;
    }
  }

  listRecentDispatches(projectId: string): AutoModeDispatchRecord[] {
    return [...(this.states.get(projectId)?.recent ?? [])];
  }

  // ---------------------------------------------------------------------
  // Introspection / test helpers
  // ---------------------------------------------------------------------

  snapshot(projectId: string): AutoModeSnapshot {
    const state = this.states.get(projectId);
    return {
      projectId,
      enabled: state?.enabled === true,
      lastSweepAt: state?.lastSweepAt ?? null,
      inFlight: this.countInFlight(projectId),
      inFlightSessionIds: this.listInFlightSessionIds(projectId),
      parked: this.listParked(projectId),
      recentDispatches: this.listRecentDispatches(projectId),
    };
  }

  /** Drops all state for one project (used by disable and by tests). */
  reset(projectId: string): void {
    this.states.delete(projectId);
  }

  /** Drops all state for every project (tests only). */
  resetAll(): void {
    this.states.clear();
  }
}

/**
 * globalThis-backed singleton (scheduler/watchdog/night-registry pattern): a
 * dev hot reload re-evaluates module scope, and a standing sweep writing to a
 * stale instance while GET auto-mode reads a fresh empty one would make the
 * mode look idle while it is dispatching.
 */
const AUTO_MODE_REGISTRY_GLOBAL_KEY = Symbol.for("arij.auto-mode-registry");

function getAutoModeRegistry(): AutoModeRegistry {
  const store = globalThis as {
    [AUTO_MODE_REGISTRY_GLOBAL_KEY]?: AutoModeRegistry;
  };
  if (!store[AUTO_MODE_REGISTRY_GLOBAL_KEY]) {
    store[AUTO_MODE_REGISTRY_GLOBAL_KEY] = new AutoModeRegistry();
  }
  return store[AUTO_MODE_REGISTRY_GLOBAL_KEY];
}

/** Singleton instance (class exported for isolated unit tests). */
export const autoModeRegistry = getAutoModeRegistry();
