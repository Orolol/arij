import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions, epics, projects } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const DAY_MS = 86_400_000;

/**
 * SQLite `CURRENT_TIMESTAMP` writes "YYYY-MM-DD HH:MM:SS" while the session
 * lifecycle writes ISO strings ("YYYY-MM-DDTHH:MM:SS.sssZ"). Comparing the
 * two lexically only works once the `T` is normalised away — hence the
 * `replace(col, 'T', ' ')` on every timestamp predicate below. The cutoff is
 * formatted the same way, in UTC.
 */
function utcCutoff(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * GET /api/dashboard/summary
 *
 * Cross-project ambient aggregate for the dashboard band. Derived on every
 * call from `agent_sessions` — nothing here is stored.
 *
 * Deliberate omissions:
 * - registry-only activity (chat conversations) is NOT counted as a running
 *   session: the band reports database truth;
 * - there is no live cost for running sessions — providers only report usage
 *   at session end.
 */
export async function GET() {
  const cutoff = utcCutoff(DAY_MS);

  const runningRows = db
    .select({
      sessionId: agentSessions.id,
      projectId: agentSessions.projectId,
      projectName: projects.name,
      epicId: agentSessions.epicId,
      epicReadableId: epics.readableId,
      provider: agentSessions.provider,
      agentType: agentSessions.agentType,
      startedAt: agentSessions.startedAt,
      createdAt: agentSessions.createdAt,
    })
    .from(agentSessions)
    .leftJoin(projects, eq(agentSessions.projectId, projects.id))
    .leftJoin(epics, eq(agentSessions.epicId, epics.id))
    .where(eq(agentSessions.status, "running"))
    .orderBy(desc(agentSessions.createdAt))
    .all();

  const nightRow = db
    .select({
      projects: sql<number>`COUNT(DISTINCT ${agentSessions.projectId})`,
      totalCostUsd: sql<number>`COALESCE(SUM(${agentSessions.totalCostUsd}), 0)`,
    })
    .from(agentSessions)
    .where(
      and(
        sql`${agentSessions.batchRunId} LIKE 'night_%'`,
        sql`replace(${agentSessions.createdAt}, 'T', ' ') >= ${cutoff}`
      )
    )
    .get();

  const terminalRows = db
    .select({
      status: agentSessions.status,
      total: sql<number>`COUNT(*)`,
    })
    .from(agentSessions)
    .where(
      and(
        inArray(agentSessions.status, ["completed", "failed"]),
        sql`replace(COALESCE(${agentSessions.endedAt}, ${agentSessions.completedAt}, ${agentSessions.createdAt}), 'T', ' ') >= ${cutoff}`
      )
    )
    .groupBy(agentSessions.status)
    .all();

  const yesterday = { completed: 0, failed: 0 };
  for (const row of terminalRows) {
    if (row.status === "completed") yesterday.completed = Number(row.total) || 0;
    else if (row.status === "failed") yesterday.failed = Number(row.total) || 0;
  }

  return NextResponse.json({
    data: {
      runningSessions: runningRows.map((row) => ({
        sessionId: row.sessionId,
        projectId: row.projectId,
        projectName: row.projectName ?? null,
        epicId: row.epicId ?? null,
        epicReadableId: row.epicReadableId ?? null,
        provider: row.provider ?? null,
        agentType: row.agentType ?? null,
        startedAt: row.startedAt ?? row.createdAt ?? null,
      })),
      nightRunsLastNight: {
        projects: Number(nightRow?.projects ?? 0),
        totalCostUsd: Number(nightRow?.totalCostUsd ?? 0),
      },
      yesterday,
    },
  });
}
