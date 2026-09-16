import { NextRequest } from "next/server";
import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import { dispatchEpicBuild } from "@/lib/build/dispatch-epic";
export const POST = withAgentResolutionErrors(async (request: NextRequest, { params }: { params: Promise<{ projectId: string; epicId: string }> }) => {
  const { projectId, epicId } = await params;
  const body = await request.json().catch(() => ({}));
  return dispatchEpicBuild(projectId, epicId, body);
});
