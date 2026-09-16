import { NextRequest } from "next/server";
import {
  handleDeleteAgentPrompt,
  handlePutAgentPrompt,
} from "@/lib/agent-config/prompt-routes";

type Params = { params: Promise<{ agentType: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { agentType } = await params;
  return handlePutAgentPrompt(request, agentType, "global");
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { agentType } = await params;
  return handleDeleteAgentPrompt(agentType, "global");
}
