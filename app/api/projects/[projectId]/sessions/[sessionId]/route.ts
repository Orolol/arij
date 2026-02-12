import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processManager } from "@/lib/claude/process-manager";
import { isValidTransition, type SessionStatus } from "@/lib/sessions/status-machine";
import { getSessionLastText } from "@/lib/sessions/last-text";
import fs from "fs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
) {
  const { sessionId } = await params;

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let logs = null;
  if (session.logsPath && fs.existsSync(session.logsPath)) {
    try {
      logs = JSON.parse(fs.readFileSync(session.logsPath, "utf-8"));
    } catch {
      logs = null;
    }
  }

  // Extract last non-empty text from result or logs
  const pmInfo = processManager.getStatus(sessionId);
  const resultText = pmInfo?.result?.result ?? (logs?.result as string | undefined) ?? null;
  const lastNonEmptyText = getSessionLastText(session.logsPath, resultText);

  return NextResponse.json({ data: { ...session, logs, lastNonEmptyText } });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
) {
  const { sessionId } = await params;

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const currentStatus = session.status as SessionStatus;
  if (!isValidTransition(currentStatus, "cancelled")) {
    return NextResponse.json(
      { error: `Cannot cancel session in '${currentStatus}' state` },
      { status: 400 }
    );
  }

  // Cancel in process manager
  processManager.cancel(sessionId);

  // Update DB with validated transition
  const now = new Date().toISOString();
  db.update(agentSessions)
    .set({ status: "cancelled", completedAt: now, error: "Cancelled by user" })
    .where(eq(agentSessions.id, sessionId))
    .run();

  return NextResponse.json({ data: { cancelled: true } });
}
