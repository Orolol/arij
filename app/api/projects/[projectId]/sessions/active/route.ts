import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionLastText } from "@/lib/sessions/last-text";
import { processManager } from "@/lib/claude/process-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const active = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.status, "running")
      )
    )
    .all();

  // Enrich each active session with lastNonEmptyText
  const enriched = active.map((session) => {
    // Try to get result text from process manager first
    const pmInfo = processManager.getStatus(session.id);
    const resultText = pmInfo?.result?.result ?? null;

    return {
      ...session,
      lastNonEmptyText: getSessionLastText(session.logsPath, resultText),
    };
  });

  return NextResponse.json({ data: enriched });
}
