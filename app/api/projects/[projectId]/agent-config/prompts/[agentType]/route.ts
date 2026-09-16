import { NextRequest } from "next/server";
import {
  handleDeleteAgentPrompt,
  handlePutAgentPrompt,
} from "@/lib/agent-config/prompt-routes";

type Params = { params: Promise<{ projectId: string; agentType: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId, agentType } = await params;
  return handlePutAgentPrompt(request, agentType, projectId);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { projectId, agentType } = await params;
  return handleDeleteAgentPrompt(agentType, projectId);
}
