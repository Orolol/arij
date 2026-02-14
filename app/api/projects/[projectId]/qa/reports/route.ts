import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, qaReports } from "@/lib/db/schema";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const reports = db
    .select()
    .from(qaReports)
    .where(eq(qaReports.projectId, projectId))
    .orderBy(desc(qaReports.createdAt))
    .all();

  return NextResponse.json({ data: reports });
}
