import { NextRequest, NextResponse } from "next/server";
import {
  getNamedAgent,
  updateNamedAgent,
  deleteNamedAgent,
} from "@/lib/agent-config/named-agents";
import { updateNamedAgentSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

type Params = { params: Promise<{ agentId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const agent = await getNamedAgent(agentId);
  if (!agent) {
    return NextResponse.json({ error: "Named agent not found" }, { status: 404 });
  }
  return NextResponse.json({ data: agent });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const validated = await validateBody(updateNamedAgentSchema, request);
  if (isValidationError(validated)) return validated;

  const updates = validated.data;

  try {
    const result = await updateNamedAgent(agentId, updates);
    if (result.error) {
      const status = result.error.includes("not found") ? 404 : result.error.includes("already exists") ? 409 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ data: result.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update named agent";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("already exists")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const deleted = await deleteNamedAgent(agentId);
  if (!deleted) {
    return NextResponse.json({ error: "Named agent not found" }, { status: 404 });
  }
  return NextResponse.json({ data: { ok: true } });
}
