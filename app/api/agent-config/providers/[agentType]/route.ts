import { NextRequest } from "next/server";
import {
  handleDeleteProviderDefault,
  handlePutProviderDefault,
} from "@/lib/agent-config/provider-routes";

type Params = { params: Promise<{ agentType: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { agentType } = await params;
  return handlePutProviderDefault(request, agentType, "global");
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { agentType } = await params;
  return handleDeleteProviderDefault(agentType, "global");
}
