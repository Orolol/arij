import { NextResponse } from "next/server";
import { listMergedProjectAgentProviders } from "@/lib/agent-config/agent-resolution";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const data = await listMergedProjectAgentProviders(projectId);
  return NextResponse.json({ data });
}
