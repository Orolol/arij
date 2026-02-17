import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { releases, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { publishRelease, getRelease } from "@/lib/github/releases";
import { logSyncOperation } from "@/lib/github/sync-log";

type Params = { params: Promise<{ projectId: string; releaseId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId, releaseId } = await params;

  // 1. Look up release by releaseId
  const release = db
    .select()
    .from(releases)
    .where(eq(releases.id, releaseId))
    .get();

  if (!release) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  // 2. Check that release has a GitHub draft release
  if (!release.githubReleaseId) {
    return NextResponse.json(
      {
        error:
          "This release has not published to GitHub yet (no draft release).",
      },
      { status: 400 }
    );
  }

  // 3. Check that release belongs to the given project
  if (release.projectId !== projectId) {
    return NextResponse.json(
      { error: "Release does not belong to this project." },
      { status: 400 }
    );
  }

  // 4. Look up project for GitHub owner/repo
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project?.githubOwnerRepo) {
    return NextResponse.json(
      { error: "Project has no GitHub repository configured." },
      { status: 400 }
    );
  }

  const [owner, repo] = project.githubOwnerRepo.split("/");

  // 5. Check if the release is already published (not a draft)
  const current = await getRelease({
    owner,
    repo,
    releaseId: release.githubReleaseId,
  });

  if (!current.draft) {
    return NextResponse.json(
      { error: "Release is already published." },
      { status: 409 }
    );
  }

  // 6. Publish the draft release
  const result = await publishRelease({
    owner,
    repo,
    releaseId: release.githubReleaseId,
  });

  // 7. Update local release record
  const now = new Date().toISOString();
  db.update(releases)
    .set({ githubReleaseUrl: result.htmlUrl, pushedAt: now })
    .where(eq(releases.id, releaseId))
    .run();

  // 8. Log sync operation
  logSyncOperation({
    projectId,
    operation: "release",
    status: "success",
    detail: {
      releaseId: release.githubReleaseId,
      action: "publish",
    },
  });

  // 9. Return updated release
  const updated = db
    .select()
    .from(releases)
    .where(eq(releases.id, releaseId))
    .get();

  return NextResponse.json({ data: updated });
}
