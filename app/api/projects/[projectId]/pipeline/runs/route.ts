import { NextRequest, NextResponse } from "next/server";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { listPipelineRunsByProject } from "@/lib/pipeline/registry";

/**
 * GET /api/projects/[projectId]/pipeline/runs
 *
 * Pipeline run snapshots for the project: active runs plus the registry's
 * recent terminal ring (in-memory — a restart clears both; the activity log
 * keeps the durable trace). Consumed by usePipelineRuns to badge session
 * rows with "Pipeline · <stage>" chips.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  return NextResponse.json({ data: listPipelineRunsByProject(projectId) });
}
