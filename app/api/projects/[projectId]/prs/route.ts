import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pullRequests } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

/** How many PR pills the repo status bar has room for. */
const MAX_PRS = 3;

/**
 * GET /api/projects/[projectId]/prs
 *
 * The still-open pull requests of a project, newest first — the repo status
 * bar renders them as pills. Only `open`/`draft` rows: a merged or closed PR
 * is not something the footer should keep nagging about.
 *
 * Stored rows only. GitHub check runs / review state are NOT fetched here:
 * that data is not in the database and the footer must never block on a
 * network round-trip.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const rows = db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      url: pullRequests.url,
      title: pullRequests.title,
      status: pullRequests.status,
      epicId: pullRequests.epicId,
      headBranch: pullRequests.headBranch,
      createdAt: pullRequests.createdAt,
    })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.projectId, projectId),
        inArray(pullRequests.status, ["open", "draft"])
      )
    )
    .orderBy(desc(pullRequests.createdAt), desc(pullRequests.number))
    .limit(MAX_PRS)
    .all();

  return NextResponse.json({ data: rows });
}
