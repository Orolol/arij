import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentProviderDefaults } from "@/lib/db/schema";
import { or, eq } from "drizzle-orm";
import { AGENT_TYPES, AGENT_TYPE_LABELS } from "@/lib/types/agent-config";
import type { AgentType } from "@/lib/types/agent-config";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const rows = db
    .select()
    .from(agentProviderDefaults)
    .where(
      or(
        eq(agentProviderDefaults.scope, "global"),
        eq(agentProviderDefaults.scope, projectId)
      )
    )
    .all();

  const globalMap = new Map(
    rows.filter((r) => r.scope === "global").map((r) => [r.agentType, r])
  );
  const projectMap = new Map(
    rows.filter((r) => r.scope === projectId).map((r) => [r.agentType, r])
  );

  const data = AGENT_TYPES.map((type) => {
    const projectRow = projectMap.get(type);
    const globalRow = globalMap.get(type);
    return {
      agentType: type,
      label: AGENT_TYPE_LABELS[type as AgentType],
      provider: projectRow?.provider ?? globalRow?.provider ?? "claude-code",
      source: projectRow ? "project" : globalRow ? "global" : "default",
    };
  });

  return NextResponse.json({ data });
}
