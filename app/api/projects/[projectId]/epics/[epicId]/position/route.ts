/**
 * /api/projects/:projectId/epics/:epicId/position — where a ticket stands in
 * its own column, and the manual way to move it.
 *
 * GET  → { data: { status, rank, total, movable } }
 * POST { move: "up" | "down" | "top" | "bottom" } → the same shape, after
 *      the move.
 *
 * `epics.position` is the execution order Full Auto, UP NEXT and the registry
 * read (`compareExecutionOrder`). The column order is recomputed server-side
 * and renumbered 0..n-1 (only the rows that change are written) through the
 * transactional core in lib/workflow/reorder.ts — the same one the refinement
 * MCP tool uses — so a manual move and an agent re-rank can never leave two
 * different orders. Read and write share one SQLite transaction, so another
 * process on the same database cannot re-rank the column in between.
 *
 * The rank is the ticket's place in ITS column, not UP NEXT's number: UP NEXT
 * merges In Progress ahead of To Do and skips blocked or waiting tickets. A
 * move past such a neighbour changes this rank and Full Auto's order once the
 * neighbour is eligible again, without changing UP NEXT today.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getEpicOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { emitTicketUpdated } from "@/lib/events/emit";
import { tryExportArjiJson } from "@/lib/sync/export";
import { moveEpicPositionSchema } from "@/lib/validation/schemas";
import { validateBody } from "@/lib/validation/validate";
import {
  moveTicketInColumn,
  readColumnPlacement,
} from "@/lib/workflow/reorder";
import { logWorkflowDecision } from "@/lib/workflow/transition-service";

type RouteContext = { params: Promise<{ projectId: string; epicId: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { projectId, epicId } = await params;
  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  // better-sqlite3 is synchronous: nothing can delete the row between the
  // lookup above and this read, so the placement exists.
  const placement = readColumnPlacement(projectId, epicId)!;
  return NextResponse.json({ data: placement });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { projectId, epicId } = await params;

  const validated = await validateBody(moveEpicPositionSchema, request);
  if (isErrorResponse(validated)) return validated;
  const { move } = validated.data;

  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  let result;
  try {
    result = moveTicketInColumn(projectId, epicId, move);
  } catch (error) {
    return errorResponse(error, "Failed to move ticket");
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.statusCode });
  }

  if (result.moved) {
    const { status, rank, total } = result.placement;
    // A same-state entry, like the refinement tool's: the ticket's history
    // should say why it now runs before (or after) its neighbours.
    logWorkflowDecision({
      projectId,
      epicId,
      status,
      actor: "user",
      reason: `Moved ${move} to position ${rank} of ${total} in ${status}`,
    });
    // One event for the moved ticket: its open overlay refreshes on its own
    // id, and the desk and registry re-read the whole column on their poll.
    emitTicketUpdated(projectId, epicId, { position: result.position });
    tryExportArjiJson(projectId);
  }

  return NextResponse.json({ data: result.placement });
}
