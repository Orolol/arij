import { NextRequest, NextResponse } from "next/server";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaReports, agentSessions } from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { liveCheckSql } from "@/lib/qa/check-liveness-sql";
import { QA_REPORT_HISTORY_LIMIT, QA_CHECK_SUMMARY_LIMIT } from "@/lib/qa/types";
import { isCheckLive } from "@/lib/qa/aggregate";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const rows = db
    .select({
      id: qaReports.id,
      projectId: qaReports.projectId,
      status: qaReports.status,
      checkType: qaReports.checkType,
      summary: sql<string | null>`SUBSTR(${qaReports.summary}, 1, ${sql.raw(String(QA_CHECK_SUMMARY_LIMIT))})`,
      agentSessionId: qaReports.agentSessionId,
      sessionStatus: agentSessions.status,
      createdAt: qaReports.createdAt,
      completedAt: qaReports.completedAt,
    })
    .from(qaReports)
    .leftJoin(agentSessions, eq(qaReports.agentSessionId, agentSessions.id))
    .where(eq(qaReports.projectId, projectId))
    .orderBy(desc(liveCheckSql()), desc(sql`julianday(${qaReports.createdAt})`), desc(qaReports.id))
    .limit(QA_REPORT_HISTORY_LIMIT)
    .all();

  const reports = rows.map((row) => ({
    ...row,
    live: isCheckLive({ status: row.status, sessionStatus: row.sessionStatus }),
  }));

  return NextResponse.json({ data: reports });
}
