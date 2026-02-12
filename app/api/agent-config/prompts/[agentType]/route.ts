import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentPrompts } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { isAgentType } from "@/lib/agent-config/constants";

type Params = { params: Promise<{ agentType: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { agentType } = await params;
  if (!isAgentType(agentType)) {
    return NextResponse.json({ error: `Unknown agent type: ${agentType}` }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : null;
  if (systemPrompt == null) {
    return NextResponse.json(
      { error: "systemPrompt string is required" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const existing = db
    .select({
      id: agentPrompts.id,
    })
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, "global"))
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
        scope: "global",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const updated = db
    .select()
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, "global"))
    )
    .get();

  return NextResponse.json({ data: updated });
}
