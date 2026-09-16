/**
 * POST /api/projects/:projectId/epics/reorder — the board's ordering
 * endpoint, used by drag-and-drop and by whole-column actions such as
 * "Sort by priority".
 *
 * The position write and the status transitions run through the shared
 * transactional core in lib/workflow/reorder.ts, which the agent-facing
 * reorder MCP tool uses as well — one implementation, so board `position`
 * stays the single ordering source no matter who writes it.
 */

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, isErrorResponse } from "@/lib/api/route-helpers";
import { validateBody } from "@/lib/validation/validate";
import { reorderTicketsSchema } from "@/lib/validation/schemas";
import { tryExportArjiJson } from "@/lib/sync/export";
import { reorderTickets } from "@/lib/workflow/reorder";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(reorderTicketsSchema, request);
  if (isErrorResponse(validated)) return validated;
  const body = validated.data;

  let result;
  try {
    result = reorderTickets(projectId, body.items, {
      actor: "user",
      source: "drag",
      reason: "Kanban drag-and-drop",
      reorderOnly: body.reorderOnly,
    });
  } catch (error) {
    return errorResponse(error, "Failed to reorder epics");
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.statusCode });
  }

  tryExportArjiJson(projectId);
  return NextResponse.json({
    data: { updated: result.updated, skipped: result.skipped },
  });
}
