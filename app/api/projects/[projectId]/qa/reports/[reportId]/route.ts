import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaReports } from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";

type Params = { params: Promise<{ projectId: string; reportId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, reportId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const report = db
    .select()
    .from(qaReports)
    .where(and(eq(qaReports.id, reportId), eq(qaReports.projectId, projectId)))
    .get();

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json({ data: report });
}
