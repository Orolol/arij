import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { releases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GitHubNotConfiguredError } from "@/lib/github/client";
import { publishRelease, getRelease } from "@/lib/github/releases";
import { logSyncOperation } from "@/lib/github/sync-log";
import { emitReleaseUpdated } from "@/lib/events/emit";
import {
  getProjectOr404,
  isErrorResponse,
  errorResponse,
} from "@/lib/api/route-helpers";

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
  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;
  const { project } = found;

  if (!project.githubOwnerRepo) {
    return NextResponse.json(
      { error: "Project has no GitHub repository configured." },
      { status: 400 }
    );
  }

  const [owner, repo] = project.githubOwnerRepo.split("/");

  try {
    // 5. Check if the release is already published (not a draft)
    const current = await getRelease({
      owner,
      repo,
      releaseId: release.githubReleaseId,
    });

    if (!current.draft) {
      // Published outside Arij (or by a lost request). Recording it is what
      // stops the page offering Publish for this release forever — the
      // backfill of migration 0057 deliberately leaves doubtful rows as
      // drafts and relies on this answer to heal them.
      if (!release.publishedAt) {
        db.update(releases)
          .set({ publishedAt: new Date().toISOString() })
          .where(eq(releases.id, releaseId))
          .run();
        // The page reloads on this; it only reloads on a successful publish
        // otherwise, and would keep offering Publish over the 409.
        emitReleaseUpdated(projectId, releaseId);
      }
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

    // 7. Update local release record. `publishedAt` is the one field that
    // makes a release "published" (#105); `pushedAt` keeps recording when the
    // draft reached GitHub and is left as it was.
    const now = new Date().toISOString();
    db.update(releases)
      .set({ githubReleaseUrl: result.htmlUrl, publishedAt: now })
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
  } catch (error) {
    // Same recoverable state as the other GitHub routes: 400 + `code`, never a
    // 500 the UI cannot act on.
    if (error instanceof GitHubNotConfiguredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }
    return errorResponse(error, "Failed to publish release.");
  }
}
