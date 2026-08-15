import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getTicketDependencies,
  getTicketDependents,
} from "@/lib/dependencies/validation";
import { setTicketDependencies } from "@/lib/dependencies/crud";
import { CycleError, CrossProjectError } from "@/lib/dependencies/validation";
import {
  errorResponse,
  getEpicOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { validateBody, isValidationError } from "@/lib/validation/validate";

type RouteParams = { params: Promise<{ projectId: string; epicId: string }> };

const setDependenciesSchema = z.object({
  dependsOnIds: z.array(z.string()),
});

/**
 * GET /api/projects/[projectId]/epics/[epicId]/dependencies
 * Returns both predecessors (depends on) and successors (depended on by).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId, epicId } = await params;

  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  const predecessors = getTicketDependencies(epicId);
  const successors = getTicketDependents(epicId);

  return NextResponse.json({
    data: {
      predecessors,
      successors,
    },
  });
}

/**
 * PUT /api/projects/[projectId]/epics/[epicId]/dependencies
 * Replace all predecessors for this epic.
 * Body: { dependsOnIds: string[] }
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { projectId, epicId } = await params;

  const validated = await validateBody(setDependenciesSchema, request);
  if (isValidationError(validated)) return validated;
  const { dependsOnIds } = validated.data;

  // Validate epic exists (project-scoped)
  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  // Validate no self-references
  if (dependsOnIds.includes(epicId)) {
    return NextResponse.json(
      { error: "A ticket cannot depend on itself" },
      { status: 400 }
    );
  }

  try {
    const created = setTicketDependencies(projectId, epicId, dependsOnIds);
    return NextResponse.json({ data: created });
  } catch (error) {
    if (error instanceof CycleError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "CYCLE_DETECTED",
          cycle: error.cycle,
        },
        { status: 422 }
      );
    }
    if (error instanceof CrossProjectError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "CROSS_PROJECT_DEPENDENCY",
        },
        { status: 422 }
      );
    }
    return errorResponse(error, "Failed to update dependencies");
  }
}
