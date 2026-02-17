import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketActivityLog } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

/**
 * GET /api/projects/:projectId/epics/:epicId/activity
 *
 * Query activity log for a specific epic.
 * Supports: ?limit=...&offset=...
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const rows = db
    .select()
    .from(ticketActivityLog)
    .where(
      and(
        eq(ticketActivityLog.projectId, projectId),
        eq(ticketActivityLog.epicId, epicId)
      )
    )
    .orderBy(desc(ticketActivityLog.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ data: rows });
}
