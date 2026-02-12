import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentProviderDefaults } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AGENT_TYPES, AGENT_TYPE_LABELS } from "@/lib/types/agent-config";
import type { AgentType } from "@/lib/types/agent-config";

export async function GET() {
  const rows = db
    .select()
    .from(agentProviderDefaults)
    .where(eq(agentProviderDefaults.scope, "global"))
    .all();

  const providerMap = new Map(rows.map((r) => [r.agentType, r]));

  const data = AGENT_TYPES.map((type) => {
    const row = providerMap.get(type);
    return {
      agentType: type,
      label: AGENT_TYPE_LABELS[type as AgentType],
      provider: row?.provider ?? "claude-code",
      isCustom: !!row,
      updatedAt: row?.updatedAt ?? null,
    };
  });

  return NextResponse.json({ data });
}
