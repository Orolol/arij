import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentPrompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AGENT_TYPES, AGENT_TYPE_LABELS } from "@/lib/types/agent-config";
import type { AgentType } from "@/lib/types/agent-config";

export async function GET() {
  const rows = db
    .select()
    .from(agentPrompts)
    .where(eq(agentPrompts.scope, "global"))
    .all();

  const promptMap = new Map(rows.map((r) => [r.agentType, r]));

  const data = AGENT_TYPES.map((type) => {
    const row = promptMap.get(type);
    return {
      agentType: type,
      label: AGENT_TYPE_LABELS[type as AgentType],
      systemPrompt: row?.systemPrompt ?? null,
      isCustom: !!row,
      updatedAt: row?.updatedAt ?? null,
    };
  });

  return NextResponse.json({ data });
}
