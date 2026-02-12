import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentProviderDefaults } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { isValidAgentType, isValidProvider } from "@/lib/types/agent-config";

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
  const { provider } = body;

  if (!provider || !isValidProvider(provider)) {
    return NextResponse.json(
      { error: "provider must be 'claude-code' or 'codex'" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(agentProviderDefaults)
    .where(
      and(
        eq(agentProviderDefaults.agentType, agentType),
        eq(agentProviderDefaults.scope, "global")
      )
    )
    .get();

  if (existing) {
    db.update(agentProviderDefaults)
      .set({ provider, updatedAt: now })
      .where(eq(agentProviderDefaults.id, existing.id))
      .run();

    return NextResponse.json({
      data: { ...existing, provider, updatedAt: now },
    });
  }

  const newRow = {
    id: createId(),
    agentType,
    provider,
    scope: "global",
    createdAt: now,
    updatedAt: now,
  };

  db.insert(agentProviderDefaults).values(newRow).run();

  return NextResponse.json({ data: newRow }, { status: 201 });
}
