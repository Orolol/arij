import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentPrompts } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { isAgentType } from "@/lib/agent-config/constants";
import { updateAgentPromptSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

/**
 * Shared handlers for PUT and DELETE on agent prompts (global and project scopes).
 */
export async function handlePutAgentPrompt(
  request: NextRequest,
  agentType: string,
  scope: "global" | string,
) {
  if (!isAgentType(agentType)) {
    return NextResponse.json({ error: `Unknown agent type: ${agentType}` }, { status: 400 });
  }

  if (scope !== "global") {
    const found = getProjectOr404(scope);
    if (isErrorResponse(found)) return found;
  }

  const validated = await validateBody(updateAgentPromptSchema, request);
  if (isValidationError(validated)) return validated;
  const { systemPrompt } = validated.data;

  const now = new Date().toISOString();
  const existing = db
    .select({
      id: agentPrompts.id,
    })
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, scope)),
    )
    .get();

  if (existing) {
    db.update(agentPrompts)
      .set({
        systemPrompt,
        updatedAt: now,
      })
      .where(eq(agentPrompts.id, existing.id))
      .run();
  } else {
    db.insert(agentPrompts)
      .values({
        id: createId(),
        agentType,
        systemPrompt,
        scope,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const updated = db
    .select()
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, scope)),
    )
    .get();

  return NextResponse.json({ data: updated });
}

export async function handleDeleteAgentPrompt(
  agentType: string,
  scope: "global" | string,
) {
  if (!isAgentType(agentType)) {
    return NextResponse.json({ error: `Unknown agent type: ${agentType}` }, { status: 400 });
  }

  if (scope !== "global") {
    const found = getProjectOr404(scope);
    if (isErrorResponse(found)) return found;
  }

  const result = db
    .delete(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, scope)),
    )
    .run();

  return NextResponse.json({
    data: {
      ok: true,
      deleted: result.changes > 0,
    },
  });
}
