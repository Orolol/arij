import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const sessions = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.projectId, projectId))
    .orderBy(desc(agentSessions.createdAt))
    .all();

  return NextResponse.json({ data: sessions });
}
