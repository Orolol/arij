import { NextRequest, NextResponse } from "next/server";
import {
  deleteCustomReviewAgent,
  updateCustomReviewAgent,
} from "@/lib/agent-config/review-agents";
import { updateReviewAgentSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

type Params = { params: Promise<{ agentId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const validated = await validateBody(updateReviewAgentSchema, request);
  if (isValidationError(validated)) return validated;

  const { name, systemPrompt, isEnabled } = validated.data;

  const result = await updateCustomReviewAgent(agentId, {
    name,
    systemPrompt,
    isEnabled,
  });

  if (result.error) {
    const status = result.error === "Custom review agent not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
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

  return NextResponse.json({ data: { ok: true } });
}
