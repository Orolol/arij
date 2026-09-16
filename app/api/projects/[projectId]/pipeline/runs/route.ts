import { NextRequest, NextResponse } from "next/server";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { listPipelineRunsByProject } from "@/lib/pipeline/registry";

/**
 * GET /api/projects/[projectId]/pipeline/runs[?epicId=…]
 *
 * Pipeline run snapshots for the project: active runs plus the registry's
 * recent terminal ring (in-memory — a restart clears both; the activity log
 * keeps the durable trace).
 *
 * Consumers: `usePipelineRuns` (the "Pipeline · <stage>" chip on the story
 * page's AgentActionsBar) and `useTicketPipelineRun` (the ticket overlay's
 * PIPELINE card, which passes `epicId` so it reads its own ticket's runs
 * only — story-scoped runs are keyed on their parent epic too).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const runs = listPipelineRunsByProject(projectId);
  const epicId = request.nextUrl.searchParams.get("epicId");
  return NextResponse.json({
    data: epicId ? runs.filter((run) => run.epicId === epicId) : runs,
  });
}
