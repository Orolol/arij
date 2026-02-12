import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processManager } from "@/lib/claude/process-manager";
import fs from "fs";
import {
  getSessionStatusForApi,
  isSessionLifecycleConflictError,
  isSessionNotFoundError,
  markSessionCancelled,
} from "@/lib/agent-sessions/lifecycle";

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

  return NextResponse.json({
    data: {
      ...session,
      status: getSessionStatusForApi(session.status),
      logs,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
) {
  const { sessionId } = await params;

  processManager.cancel(sessionId);
  const now = new Date().toISOString();

  try {
    markSessionCancelled(sessionId, "Cancelled by user", now);
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (isSessionLifecycleConflictError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 409 }
      );
    }
    throw error;
  }

  return NextResponse.json({ data: { cancelled: true } });
}
