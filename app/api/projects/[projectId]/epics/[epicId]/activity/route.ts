import { NextRequest, NextResponse } from "next/server";
import { getEpicOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { getEpicActivity } from "@/lib/workflow/log";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

/**
 * GET /api/projects/[projectId]/epics/[epicId]/activity
 *
 * Kanban transition audit trail for an epic (written by `logTransition` on
 * every status change), newest first.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;

  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  const entries = getEpicActivity({ epicId });

  return NextResponse.json({ data: entries });
}
