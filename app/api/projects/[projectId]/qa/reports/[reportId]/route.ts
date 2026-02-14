import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, qaReports } from "@/lib/db/schema";

type Params = { params: Promise<{ projectId: string; reportId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, reportId } = await params;

  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

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
