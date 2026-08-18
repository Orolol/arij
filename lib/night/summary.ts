import { and, asc, desc, eq, isNull, like, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, epics } from "@/lib/db/schema";
import type { TicketExecutionStatus } from "@/lib/dependencies/scheduler";
import {
  NIGHT_RUN_ID_PREFIX,
  type NightRunDetail,
  type NightRunEpicEntry,
  type NightRunListEntry,
} from "./constants";
import { nightRunRegistry, type NightRunSnapshot } from "./registry";

/**
 * Night-run summaries: registry-first (live or recently finished runs), else
 * re-derived from the database by run id.
 *
 * Every session a night run dispatches — wave builds, pipeline stages,
 * forensic diagnostics — carries `agent_sessions.batch_run_id = <runId>`
 * (migration 0026), so a run whose in-memory snapshot died with a server
 * restart can still tell its morning story: tagged sessions grouped per
 * epic, statuses from their terminal rows (boot sweeps already cancelled/
 * failed the orphans), cost from SUM(total_cost_usd).
 *
 * Cost blind spot (accepted): only the Claude Code CLI reports
 * total_cost_usd, so totals are lower bounds. `costIsPartial` is true when
 * at least one tagged session has a NULL cost.
 */

/** How many DB-derived (interrupted) runs the list route surfaces. */
export const NIGHT_DB_DERIVED_RUNS_LIMIT = 10;

interface TaggedSessionRow {
  id: string;
  epicId: string | null;
  status: string | null;
  outcome: string | null;
  createdAt: string | null;
  completedAt: string | null;
  totalCostUsd: number | null;
}

function loadTaggedSessions(runId: string): TaggedSessionRow[] {
  return db
    .select({
      id: agentSessions.id,
      epicId: agentSessions.epicId,
      status: agentSessions.status,
      outcome: agentSessions.outcome,
      createdAt: agentSessions.createdAt,
      completedAt: agentSessions.completedAt,
      totalCostUsd: agentSessions.totalCostUsd,
    })
    .from(agentSessions)
    .where(eq(agentSessions.batchRunId, runId))
    .orderBy(asc(agentSessions.createdAt))
    .all();
}

/** SUM of Claude-reported costs across every session tagged with the run. */
export function sumNightRunCost(runId: string): number {
  const row = db
    .select({
      total: sql<number>`COALESCE(SUM(${agentSessions.totalCostUsd}), 0)`,
    })
    .from(agentSessions)
    .where(eq(agentSessions.batchRunId, runId))
    .get();
  return row?.total ?? 0;
}

/** True when at least one tagged session reported no cost (lower-bound total). */
export function isNightRunCostPartial(runId: string): boolean {
  const row = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.batchRunId, runId),
        isNull(agentSessions.totalCostUsd)
      )
    )
    .get();
  return (row?.count ?? 0) > 0;
}

function emptyCounts(): Record<TicketExecutionStatus, number> {
  return { pending: 0, running: 0, done: 0, asked: 0, failed: 0, skipped: 0 };
}

function epicLabel(epicId: string): {
  readableId: string | null;
  title: string | null;
} {
  const epic = db
    .select({ readableId: epics.readableId, title: epics.title })
    .from(epics)
    .where(eq(epics.id, epicId))
    .get();
  return { readableId: epic?.readableId ?? null, title: epic?.title ?? null };
}

/** Per-epic session ids + cost from the tagged rows (dispatch order). */
function groupSessionsByEpic(rows: TaggedSessionRow[]): Map<
  string,
  { sessionIds: string[]; costUsd: number | null; last: TaggedSessionRow }
> {
  const byEpic = new Map<
    string,
    { sessionIds: string[]; costUsd: number | null; last: TaggedSessionRow }
  >();
  for (const row of rows) {
    if (!row.epicId) continue; // forensic sessions carry no epicId
    const entry = byEpic.get(row.epicId) ?? {
      sessionIds: [],
      costUsd: null,
      last: row,
    };
    entry.sessionIds.push(row.id);
    if (typeof row.totalCostUsd === "number") {
      entry.costUsd = (entry.costUsd ?? 0) + row.totalCostUsd;
    }
    entry.last = row;
    byEpic.set(row.epicId, entry);
  }
  return byEpic;
}

function detailFromRegistry(snapshot: NightRunSnapshot): NightRunDetail {
  const rows = loadTaggedSessions(snapshot.runId);
  const byEpic = groupSessionsByEpic(rows);

  const epicsEntries: NightRunEpicEntry[] = snapshot.epics.map((epic) => {
    const sessions = byEpic.get(epic.epicId);
    const label = epicLabel(epic.epicId);
    return {
      epicId: epic.epicId,
      readableId: label.readableId,
      title: label.title,
      status: epic.status,
      reason: epic.reason,
      pipelineRunId: epic.pipelineRunId,
      sessionIds: sessions?.sessionIds ?? [],
      costUsd: sessions?.costUsd ?? null,
    };
  });

  return {
    runId: snapshot.runId,
    projectId: snapshot.projectId,
    source: "registry",
    interrupted: false,
    state: snapshot.state,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    failurePolicy: snapshot.failurePolicy,
    totalWaves: snapshot.totalWaves,
    currentWave: snapshot.currentWave,
    counts: { ...snapshot.counts },
    epics: epicsEntries,
    stopRequested: snapshot.stopRequested,
    totalCostUsd: sumNightRunCost(snapshot.runId),
    costIsPartial: isNightRunCostPartial(snapshot.runId),
    abortReason: snapshot.abortReason,
    abortedAtWave: snapshot.abortedAtWave,
    breakerThreshold: snapshot.breakerThreshold,
    costCapUsd: snapshot.costCapUsd,
  };
}

/**
 * Per-epic status from its LAST tagged session (the terminal rows boot
 * cleanup left behind): completed + answered → done, asked_question → asked,
 * everything else (failed / cancelled) → failed.
 */
function statusFromLastSession(last: TaggedSessionRow): TicketExecutionStatus {
  if (last.outcome === "asked_question") return "asked";
  if (last.status === "completed") return "done";
  return "failed";
}

function detailFromDb(runId: string): NightRunDetail | null {
  const rows = loadTaggedSessions(runId);
  if (rows.length === 0) return null;

  const projectId =
    db
      .select({ projectId: agentSessions.projectId })
      .from(agentSessions)
      .where(eq(agentSessions.batchRunId, runId))
      .get()?.projectId ?? "";

  const byEpic = groupSessionsByEpic(rows);
  const counts = emptyCounts();
  const epicsEntries: NightRunEpicEntry[] = [];

  for (const [epicId, group] of byEpic) {
    const status = statusFromLastSession(group.last);
    counts[status] += 1;
    const label = epicLabel(epicId);
    epicsEntries.push({
      epicId,
      readableId: label.readableId,
      title: label.title,
      status,
      reason: null,
      pipelineRunId: null,
      sessionIds: group.sessionIds,
      costUsd: group.costUsd,
    });
  }

  const startedAt = rows
    .map((row) => row.createdAt)
    .filter((value): value is string => !!value)
    .sort()[0];
  const endedAt = rows
    .map((row) => row.completedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);

  return {
    runId,
    projectId,
    source: "db",
    interrupted: true,
    state: "finished",
    startedAt: startedAt ?? "",
    endedAt: endedAt ?? null,
    failurePolicy: null,
    totalWaves: null,
    currentWave: null,
    counts,
    epics: epicsEntries,
    // A DB-derived run has no live engine left to stop.
    stopRequested: false,
    totalCostUsd: sumNightRunCost(runId),
    costIsPartial: isNightRunCostPartial(runId),
    abortReason: null,
    abortedAtWave: null,
    breakerThreshold: null,
    costCapUsd: null,
  };
}

/**
 * Full detail for one night run: the in-process registry first (live runs
 * and the recent terminal ring), else DB-derived from the tagged sessions
 * with `interrupted: true` — registry absence + tagged rows IS the restart
 * detection. Null when the run id is unknown on both paths.
 */
export function computeNightRunDetail(runId: string): NightRunDetail | null {
  const snapshot = nightRunRegistry.get(runId);
  if (snapshot) return detailFromRegistry(snapshot);
  return detailFromDb(runId);
}

function toListEntry(detail: NightRunDetail): NightRunListEntry {
  return {
    runId: detail.runId,
    projectId: detail.projectId,
    source: detail.source,
    interrupted: detail.interrupted,
    state: detail.state,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    counts: detail.counts,
    totalCostUsd: detail.totalCostUsd,
    abortReason: detail.abortReason,
  };
}

/**
 * List entries for GET /build/night-runs: every registry run (active first,
 * then the terminal ring) merged with recent DB-derived night-run ids the
 * registry no longer knows (restart-interrupted), flagged `interrupted`.
 *
 * The SQL LIKE pre-filter treats `_` as a single-char wildcard, so the
 * candidate ids are re-checked in JS with startsWith.
 */
export function listNightRuns(projectId: string): NightRunListEntry[] {
  const registryEntries = nightRunRegistry
    .listByProject(projectId)
    .map((snapshot) => toListEntry(detailFromRegistry(snapshot)));
  const known = new Set(registryEntries.map((entry) => entry.runId));

  const candidateRows = db
    .select({
      batchRunId: agentSessions.batchRunId,
      latest: sql<string>`MAX(${agentSessions.createdAt})`,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        like(agentSessions.batchRunId, `${NIGHT_RUN_ID_PREFIX}%`)
      )
    )
    .groupBy(agentSessions.batchRunId)
    .orderBy(desc(sql`MAX(${agentSessions.createdAt})`))
    .all();

  const dbEntries: NightRunListEntry[] = [];
  for (const row of candidateRows) {
    if (dbEntries.length >= NIGHT_DB_DERIVED_RUNS_LIMIT) break;
    const runId = row.batchRunId;
    if (!runId || !runId.startsWith(NIGHT_RUN_ID_PREFIX)) continue;
    if (known.has(runId)) continue;
    const detail = detailFromDb(runId);
    if (detail) dbEntries.push(toListEntry(detail));
  }

  return [...registryEntries, ...dbEntries];
}
