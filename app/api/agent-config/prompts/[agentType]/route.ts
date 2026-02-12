import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentPrompts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { isValidAgentType } from "@/lib/types/agent-config";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentType: string }> }
) {
  const { agentType } = await params;

  if (!isValidAgentType(agentType)) {
    return NextResponse.json(
      { error: `Invalid agent type: ${agentType}` },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { systemPrompt } = body;

  if (!systemPrompt || typeof systemPrompt !== "string") {
    return NextResponse.json(
      { error: "systemPrompt is required and must be a string" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, "global"))
    )
    .get();

  if (existing) {
    db.update(agentPrompts)
      .set({ systemPrompt, updatedAt: now })
      .where(eq(agentPrompts.id, existing.id))
      .run();

    return NextResponse.json({
      data: { ...existing, systemPrompt, updatedAt: now },
    });
  }

  const newRow = {
    id: createId(),
    agentType,
    systemPrompt,
    scope: "global",
    createdAt: now,
    updatedAt: now,
  };

  db.insert(agentPrompts).values(newRow).run();

  return NextResponse.json({ data: newRow }, { status: 201 });
}
