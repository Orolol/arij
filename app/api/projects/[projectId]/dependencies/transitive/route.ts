import { NextRequest, NextResponse } from "next/server";
import { getTransitiveDependencies } from "@/lib/dependencies/validation";

/**
 * POST /api/projects/[projectId]/dependencies/transitive
 * Compute all transitive predecessors for a set of ticket IDs.
 * Body: { ticketIds: string[] }
 * Returns: { data: { all: string[], autoIncluded: string[] } }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json();
  const { ticketIds } = body as { ticketIds?: string[] };

  if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
    return NextResponse.json(
      { error: "ticketIds array is required" },
      { status: 400 }
    );
  }

  const allIds = getTransitiveDependencies(projectId, ticketIds);
  const userSelected = new Set(ticketIds);
  const autoIncluded = Array.from(allIds).filter(
    (id) => !userSelected.has(id)
  );

  return NextResponse.json({
    data: {
      all: Array.from(allIds),
      autoIncluded,
    },
  });
}
