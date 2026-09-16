import { NextRequest } from "next/server";
import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import { dispatchBatchBuild } from "@/lib/build/dispatch";
export const POST = withAgentResolutionErrors(async (request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) => {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  return dispatchBatchBuild(projectId, body);
});
