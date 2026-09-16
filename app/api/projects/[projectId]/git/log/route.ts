import { NextResponse } from "next/server";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { getRecentSyncLogs } from "@/lib/github/sync-log";
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProjectOr404(projectId);
  if (isErrorResponse(project)) return project;
  return NextResponse.json({ data: getRecentSyncLogs(projectId, 20) });
}
