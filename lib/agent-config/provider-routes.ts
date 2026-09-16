import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentProviderDefaults, namedAgents } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { isAgentType } from "@/lib/agent-config/constants";

/**
 * Shared handlers for PUT and DELETE on agent provider defaults (global and project scopes).
 * Enforces that only valid namedAgentId assignments are written (bare provider strings rejected).
 */
export async function handlePutProviderDefault(
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

  const body = await request.json().catch(() => ({}));
  const namedAgentIdInput =
    typeof body.namedAgentId === "string" ? body.namedAgentId.trim() : "";

  if (!namedAgentIdInput) {
    return NextResponse.json(
      { error: "namedAgentId is required" },
      { status: 400 },
    );
  }

  const namedAgent = db
    .select({ id: namedAgents.id, provider: namedAgents.provider })
    .from(namedAgents)
    .where(eq(namedAgents.id, namedAgentIdInput))
    .get();

  if (!namedAgent) {
    return NextResponse.json({ error: "namedAgentId not found" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const existing = db
    .select({ id: agentProviderDefaults.id })
    .from(agentProviderDefaults)
    .where(
      and(
        eq(agentProviderDefaults.agentType, agentType),
        eq(agentProviderDefaults.scope, scope),
      ),
    )
    .get();

  if (existing) {
    db.update(agentProviderDefaults)
      .set({ provider: namedAgent.provider, namedAgentId: namedAgent.id, updatedAt: now })
      .where(eq(agentProviderDefaults.id, existing.id))
      .run();
  } else {
    db.insert(agentProviderDefaults)
      .values({
        id: createId(),
        agentType,
        provider: namedAgent.provider,
        namedAgentId: namedAgent.id,
        scope,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const updated = db
    .select()
    .from(agentProviderDefaults)
    .where(
      and(
        eq(agentProviderDefaults.agentType, agentType),
        eq(agentProviderDefaults.scope, scope),
      ),
    )
    .get();

  return NextResponse.json({ data: updated });
}

export async function handleDeleteProviderDefault(
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

  db.delete(agentProviderDefaults)
    .where(
      and(
        eq(agentProviderDefaults.agentType, agentType),
        eq(agentProviderDefaults.scope, scope),
      ),
    )
    .run();

  return NextResponse.json({ data: { ok: true } });
}
