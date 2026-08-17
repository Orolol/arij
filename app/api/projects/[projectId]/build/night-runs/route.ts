import { NextRequest, NextResponse } from "next/server";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { listNightRuns } from "@/lib/night/summary";

/**
 * GET /api/projects/[projectId]/build/night-runs
 *
 * Recent night runs of the project: live + recently finished runs from the
 * in-process registry, merged with DB-derived ids the registry no longer
 * knows (server restarted mid-run — flagged `interrupted`). Newest first
 * within each source.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  try {
    return NextResponse.json({ data: listNightRuns(projectId) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list night runs",
      },
      { status: 500 }
    );
  }
}
