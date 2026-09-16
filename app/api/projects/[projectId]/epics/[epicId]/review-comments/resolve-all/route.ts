import { NextRequest, NextResponse } from "next/server";
import { getEpicOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { resolveOpenReviewComments } from "@/lib/workflow/merge-approval";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;
  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  const count = resolveOpenReviewComments(epicId);
  return NextResponse.json({ data: { resolved: count } });
}
