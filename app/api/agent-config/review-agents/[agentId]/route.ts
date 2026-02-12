import { NextRequest, NextResponse } from "next/server";
import {
  deleteCustomReviewAgent,
  updateCustomReviewAgent,
} from "@/lib/agent-config/review-agents";

type Params = { params: Promise<{ agentId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const body = await request.json().catch(() => ({}));

  const result = await updateCustomReviewAgent(agentId, {
    name: body.name,
    systemPrompt: body.systemPrompt,
    isEnabled: body.isEnabled,
  });

  if (!result.data && result.error === "Custom review agent not found") {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (!result.data && result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const deleted = await deleteCustomReviewAgent(agentId);

  if (!deleted) {
    return NextResponse.json(
      { error: "Custom review agent not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: { deleted: true } });
}
