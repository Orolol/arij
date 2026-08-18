import { NextRequest, NextResponse } from "next/server";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { nightRunRegistry } from "@/lib/night/registry";

/**
 * POST /api/projects/[projectId]/build/night-runs/[runId]/stop
 *
 * User abort for an in-flight night run. Flags the registry entry; the
 * engine polls the flag through `shouldAbortRun` at the next wave boundary,
 * so this returns immediately with `{ stopping: true }` — the run is not
 * over yet.
 *
 * Deliberately NOT a force-cancel: in-flight pipelines settle naturally
 * (their epics still get reviewed and land in Review or fail cleanly),
 * exactly like a circuit-breaker trip. Every epic that has not launched is
 * skipped with reason "stopped by user".
 *
 * 404 for an unknown run, a run of another project, or a run that already
 * finished — there is nothing left to stop in any of those cases.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  // Registry lookup + flag happen without an await in between, so no
  // concurrent request can finish the run inside this window.
  const snapshot = nightRunRegistry.get(runId);
  if (
    !snapshot ||
    snapshot.projectId !== projectId ||
    snapshot.state !== "running" ||
    !nightRunRegistry.requestStop(runId)
  ) {
    return NextResponse.json(
      { error: "No running night run with this id" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: { stopping: true } });
}
