import { NextResponse } from "next/server";
import { listMergedProjectAgentPrompts } from "@/lib/agent-config/prompts";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    const found = getProjectOr404(projectId);
    if (isErrorResponse(found)) return found;

    const data = await listMergedProjectAgentPrompts(projectId);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent prompts" },
      { status: 500 }
    );
  }
}
