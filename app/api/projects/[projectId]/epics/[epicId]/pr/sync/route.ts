import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics, pullRequests } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getProjectOr404,
  getEpicOr404,
  isErrorResponse,
  errorResponse,
} from "@/lib/api/route-helpers";
import { GitHubNotConfiguredError } from "@/lib/github/client";
import { fetchPrStatus } from "@/lib/github/pull-requests";
import { logSyncOperation } from "@/lib/github/sync-log";

type RouteParams = { params: Promise<{ projectId: string; epicId: string }> };

/**
 * POST /api/projects/[projectId]/epics/[epicId]/pr/sync
 * Fetches the current PR status from GitHub and updates local records.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { projectId, epicId } = await params;
  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;

  // Get project
  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;
  const { project } = found;

  if (!project.githubOwnerRepo) {
    return NextResponse.json(
      { error: "GitHub owner/repo not configured." },
      { status: 400 }
    );
  }

  // Get the PR record for this epic
  const pr = db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.epicId, epicId))
    .get();

  if (!pr) {
    return NextResponse.json(
      { error: "No pull request found for this epic." },
      { status: 404 }
    );
  }

  const [owner, repo] = project.githubOwnerRepo.split("/");

  try {
    const { status, title } = await fetchPrStatus(owner, repo, pr.number);
    const now = new Date().toISOString();

    // Update pullRequests record
    db.update(pullRequests)
      .set({
        status,
        title,
        updatedAt: now,
      })
      .where(eq(pullRequests.id, pr.id))
      .run();

    // Update epic's prStatus
    db.update(epics)
      .set({
        prStatus: status,
        updatedAt: now,
      })
      .where(eq(epics.id, epicId))
      .run();

    logSyncOperation({
      projectId,
      operation: "pr_sync",
      branch: pr.headBranch,
      status: "success",
      detail: JSON.stringify({ action: "sync", prNumber: pr.number, newStatus: status }),
    });

    const updated = db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, pr.id))
      .get();

    return NextResponse.json({ data: updated });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "PR sync failed";

    logSyncOperation({
      projectId,
      operation: "pr_sync",
      branch: pr.headBranch,
      status: "failed",
      detail,
    });

    // A project without a stored PAT is an ordinary, recoverable state, not a
    // server fault: 400 with a `code` the UI branches on, matching triage and
    // epics/:epicId/pr.
    if (e instanceof GitHubNotConfiguredError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    return errorResponse(e, "Failed to sync pull request status from GitHub.");
  }
}
