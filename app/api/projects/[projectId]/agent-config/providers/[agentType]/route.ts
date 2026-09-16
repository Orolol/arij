import { NextRequest } from "next/server";
import {
  handleDeleteProviderDefault,
  handlePutProviderDefault,
} from "@/lib/agent-config/provider-routes";

type Params = { params: Promise<{ projectId: string; agentType: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId, agentType } = await params;
  return handlePutProviderDefault(request, agentType, projectId);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { projectId, agentType } = await params;
  return handleDeleteProviderDefault(agentType, projectId);
}
