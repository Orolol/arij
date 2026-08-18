import { NextRequest, NextResponse } from "next/server";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { computeNightRunDetail } from "@/lib/night/summary";

/**
 * GET /api/projects/[projectId]/build/night-runs/[runId]
 *
 * Full detail of one night run: the in-process registry first (live runs
 * and the recent terminal ring), else re-derived from the run's tagged
 * sessions (agent_sessions.batch_run_id) with `interrupted: true` — the
 * morning-after story of a run the server restart killed.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  try {
    const detail = computeNightRunDetail(runId);
    if (!detail || detail.projectId !== projectId) {
      return NextResponse.json(
        { error: "Night run not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: detail });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load the night run",
      },
      { status: 500 }
    );
  }
}
