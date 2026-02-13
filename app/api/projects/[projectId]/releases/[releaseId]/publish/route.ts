import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { releases, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { publishRelease } from "@/lib/github/releases";
import { logSyncOperation } from "@/lib/github/sync-log";

export async function POST(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ projectId: string; releaseId: string }> }
) {
  const { projectId, releaseId } = await params;

  // Load project
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.githubOwnerRepo) {
    return NextResponse.json(
      { error: "GitHub integration not configured for this project" },
      { status: 400 }
    );
  }

  // Load release
  const release = db
    .select()
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.projectId, projectId)))
    .get();
  if (!release) {
    return NextResponse.json(
      { error: "Release not found" },
      { status: 404 }
    );
  }

  if (!release.githubReleaseId) {
    return NextResponse.json(
      { error: "Release has no associated GitHub draft release" },
      { status: 400 }
    );
  }

  const [owner, repo] = project.githubOwnerRepo.split("/");

  try {
    const result = await publishRelease({
      owner,
      repo,
      releaseId: release.githubReleaseId,
    });

    // Update local release record with published URL and timestamp
    const now = new Date().toISOString();
    db.update(releases)
      .set({ githubReleaseUrl: result.url, pushedAt: now })
      .where(eq(releases.id, releaseId))
      .run();

    logSyncOperation({
      projectId,
      operation: "release",
      status: "success",
      detail: {
        releaseId: release.githubReleaseId,
        action: "publish",
        tag: release.gitTag,
        url: result.url,
      },
    });

    return NextResponse.json({
      data: { published: true, url: result.url },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    logSyncOperation({
      projectId,
      operation: "release",
      status: "failure",
      detail: {
        releaseId: release.githubReleaseId,
        action: "publish",
        error: errorMsg,
      },
    });

    return NextResponse.json(
      { error: `Failed to publish release: ${errorMsg}` },
      { status: 500 }
    );
  }
}
