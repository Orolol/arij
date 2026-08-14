import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaReports } from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const reports = db
    .select()
    .from(qaReports)
    .where(eq(qaReports.projectId, projectId))
    .orderBy(desc(qaReports.createdAt))
    .all();

  return NextResponse.json({ data: reports });
}
