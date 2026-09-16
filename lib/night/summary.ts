import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
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
  projectId: string;
  epicId: string | null;
  readableId: string | null;
  title: string | null;
  status: string | null;
  outcome: string | null;
  createdAt: string | null;
  endedAt: string | null;
  totalCostUsd: number | null;
}

function loadTaggedSessions(runId: string): TaggedSessionRow[] {
  return db
    .select({
      id: agentSessions.id,
      projectId: agentSessions.projectId,
      epicId: agentSessions.epicId,
      readableId: epics.readableId,
      title: epics.title,
      status: agentSessions.status,
      outcome: agentSessions.outcome,
      createdAt: sql<string | null>`strftime('%Y-%m-%dT%H:%M:%fZ', ${agentSessions.createdAt})`,
      endedAt: sql<string | null>`COALESCE(
        strftime('%Y-%m-%dT%H:%M:%fZ', ${agentSessions.endedAt}),
        strftime('%Y-%m-%dT%H:%M:%fZ', ${agentSessions.completedAt})
      )`,
      totalCostUsd: agentSessions.totalCostUsd,
    })
    .from(agentSessions)
    .leftJoin(epics, eq(epics.id, agentSessions.epicId))
    .where(eq(agentSessions.batchRunId, runId))
    .orderBy(asc(sql`julianday(${agentSessions.createdAt})`), asc(agentSessions.id))
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

function sessionCosts(rows: TaggedSessionRow[]) {
  return {
    totalCostUsd: rows.reduce((total, row) => total + (row.totalCostUsd ?? 0), 0),
    costIsPartial: rows.some((row) => row.totalCostUsd === null),
  };
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
  // Pending epics may have no session yet, so load the snapshot's labels in
  // one query rather than one lookup for every epic on every polling tick.
  const labels = new Map(
    (snapshot.epics.length === 0
      ? []
      : db.select({ id: epics.id, readableId: epics.readableId, title: epics.title })
          .from(epics)
          .where(and(
            eq(epics.projectId, snapshot.projectId),
            inArray(epics.id, snapshot.epics.map((epic) => epic.epicId)),
          ))
          .all()
    ).map((epic) => [epic.id, epic]),
  );

  const epicsEntries: NightRunEpicEntry[] = snapshot.epics.map((epic) => {
    const sessions = byEpic.get(epic.epicId);
    const label = labels.get(epic.epicId);
    return {
      epicId: epic.epicId,
      readableId: label?.readableId ?? null,
      title: label?.title ?? null,
      status: epic.status,
      reason: epic.reason,
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
    ...sessionCosts(rows),
    abortReason: snapshot.abortReason,
    abortedAtWave: snapshot.abortedAtWave,
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

  const projectId = rows[0].projectId;

  const byEpic = groupSessionsByEpic(rows);
  const counts = emptyCounts();
  const epicsEntries: NightRunEpicEntry[] = [];

  for (const [epicId, group] of byEpic) {
    const status = statusFromLastSession(group.last);
    counts[status] += 1;
    epicsEntries.push({
      epicId,
      readableId: group.last.readableId,
      title: group.last.title,
      status,
      reason: null,
      costUsd: group.costUsd,
    });
  }

  const startedAt = rows
    .map((row) => row.createdAt)
    .filter((value): value is string => !!value)
    .sort()[0];
  const endedAt = rows
    .map((row) => row.endedAt)
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
    ...sessionCosts(rows),
    abortReason: null,
    abortedAtWave: null,
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
 * GLOB treats the prefix's underscore literally. Exclude registry runs in
 * SQL before applying the limit so the fallback reads at most ten runs.
 */
export function listNightRuns(projectId: string): NightRunListEntry[] {
  const registryEntries = nightRunRegistry
    .listByProject(projectId)
    .map((snapshot) => toListEntry(detailFromRegistry(snapshot)));
  const known = registryEntries.map((entry) => entry.runId);

  const candidateRows = db
    .select({
      batchRunId: agentSessions.batchRunId,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        sql`${agentSessions.batchRunId} GLOB ${`${NIGHT_RUN_ID_PREFIX}*`}`,
        known.length > 0 ? notInArray(agentSessions.batchRunId, known) : undefined,
      )
    )
    .groupBy(agentSessions.batchRunId)
    .orderBy(desc(sql`MAX(julianday(${agentSessions.createdAt}))`), desc(agentSessions.batchRunId))
    .limit(NIGHT_DB_DERIVED_RUNS_LIMIT)
    .all();

  const dbEntries: NightRunListEntry[] = [];
  for (const row of candidateRows) {
    const runId = row.batchRunId;
    if (!runId) continue;
    const detail = detailFromDb(runId);
    if (detail) dbEntries.push(toListEntry(detail));
  }

  return [...registryEntries, ...dbEntries];
}
