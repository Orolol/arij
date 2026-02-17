import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketActivityLog } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/:projectId/activity
 *
 * Query the ticket activity audit log.
 * Supports optional filters: ?epicId=...&actor=...&limit=...&offset=...
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const epicId = url.searchParams.get("epicId");
  const actor = url.searchParams.get("actor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const conditions = [eq(ticketActivityLog.projectId, projectId)];
  if (epicId) {
    conditions.push(eq(ticketActivityLog.epicId, epicId));
  }
  if (actor && ["user", "agent", "system"].includes(actor)) {
    conditions.push(eq(ticketActivityLog.actor, actor));
  }

  const rows = db
    .select()
    .from(ticketActivityLog)
    .where(and(...conditions))
    .orderBy(desc(ticketActivityLog.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ data: rows });
}
