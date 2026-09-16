import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, releases } from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { updateReleaseSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { getRelease, updateDraftRelease } from "@/lib/github/releases";
import { logSyncOperation } from "@/lib/github/sync-log";
import { emitReleaseUpdated } from "@/lib/events/emit";
import { TERMINAL_STATUSES } from "@/lib/agent-sessions/lifecycle-status";

type Params = { params: Promise<{ projectId: string; releaseId: string }> };

function conflict(error: string, code: string): NextResponse {
  return NextResponse.json({ error, code }, { status: 409 });
}

/**
 * Edits a release's title and changelog (#117).
 *
 * Only until it is published: a public GitHub release is what people read,
 * and rewriting it silently from here would leave the local row and the
 * published notes free to diverge. "Published" is asked of GitHub as well as
 * of `published_at`: a release made public outside Arij is not stamped yet.
 *
 * When an edit is accepted:
 *  - while the changelog agent runs: the edit lands on the row, and the
 *    agent's compare-and-set against the fallback leaves it alone — it is the
 *    changelog the tag will carry;
 *  - while the tag, CHANGELOG commit and GitHub draft are being written: NOT
 *    accepted (409 `release_finalizing`). Finalisation read the row before
 *    this edit, so the draft and `CHANGELOG.md` would carry the old text
 *    while the row claimed the new one;
 *  - after: the row, and the GitHub draft when there is one — GitHub first,
 *    so a refused edit leaves both sides as they were. `CHANGELOG.md` on the
 *    release branch is not rewritten: the tag names that commit, and moving
 *    a (possibly pushed) tag is not an edit.
 *
 * `expectedTitle` / `expectedChangelog` guard against lost updates: an editor
 * seeded before the row changed gets a 409 `release_changed`.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { projectId, releaseId } = await params;

  const validated = await validateBody(updateReleaseSchema, request);
  if (isValidationError(validated)) return validated;
  const body = validated.data;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;
  const { project } = found;

  const joined = db
    .select({ release: releases, changelogSessionStatus: agentSessions.status })
    .from(releases)
    .leftJoin(agentSessions, eq(agentSessions.id, releases.changelogSessionId))
    .where(and(eq(releases.id, releaseId), eq(releases.projectId, projectId)))
    .get();
  if (!joined) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }
  const { release, changelogSessionStatus } = joined;
  if (release.publishedAt) {
    return conflict("Release is already published.", "release_published");
  }

  // Unfinalised and no live run = the tag and the draft are being written
  // (or are about to be, by GET's reconciliation). Everything from this read
  // to the write below is synchronous unless a GitHub draft exists, and a
  // draft only exists once finalisation is over — no request can slip in.
  const runLive =
    changelogSessionStatus !== null && !TERMINAL_STATUSES.has(changelogSessionStatus);
  if (release.finalizedAt === null && !runLive) {
    return conflict(
      "The release is being tagged; try again in a moment.",
      "release_finalizing"
    );
  }

  const patch: { title?: string | null; changelog?: string } = {};
  if (body.title !== undefined) {
    patch.title = body.title?.trim() || null;
  }
  if (body.changelog !== undefined) {
    patch.changelog = body.changelog;
  }

  if (!matchesExpected(release, body)) {
    return conflict(
      "The release changed since it was opened for editing.",
      "release_changed"
    );
  }

  if (release.githubReleaseId && project.githubOwnerRepo) {
    const [owner, repo] = project.githubOwnerRepo.split("/");
    try {
      const current = await getRelease({
        owner,
        repo,
        releaseId: release.githubReleaseId,
      });
      if (!current.draft) {
        // Public on GitHub, not stamped here yet (published outside Arij, or
        // left a draft by the 0057 backfill). Recorded the way the publish
        // route records it, so the page stops offering edit and Publish.
        db.update(releases)
          .set({ publishedAt: new Date().toISOString() })
          .where(eq(releases.id, releaseId))
          .run();
        emitReleaseUpdated(projectId, releaseId);
        return conflict("Release is already published.", "release_published");
      }

      await updateDraftRelease({
        owner,
        repo,
        releaseId: release.githubReleaseId,
        // Same naming rule as the draft's creation in POST /releases.
        ...(patch.title !== undefined
          ? {
              title: patch.title
                ? `v${release.version} — ${patch.title}`
                : `v${release.version}`,
            }
          : {}),
        ...(patch.changelog !== undefined ? { body: patch.changelog } : {}),
      });
      logSyncOperation({
        projectId,
        operation: "release",
        status: "success",
        detail: { releaseId: release.githubReleaseId, action: "edit" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logSyncOperation({
        projectId,
        operation: "release",
        status: "failed",
        detail: { releaseId: release.githubReleaseId, action: "edit", error: message },
      });
      return NextResponse.json(
        { error: `GitHub refused the edit: ${message}` },
        { status: 502 }
      );
    }

    // GitHub was awaited: re-check the guards against the row as it is now,
    // so an edit that raced another one does not win after the fact.
    const now = db.select().from(releases).where(eq(releases.id, releaseId)).get();
    if (!now || now.publishedAt || !matchesExpected(now, body)) {
      return conflict(
        "The release changed since it was opened for editing.",
        "release_changed"
      );
    }
  }

  db.update(releases).set(patch).where(eq(releases.id, releaseId)).run();
  emitReleaseUpdated(projectId, releaseId);

  const updated = db.select().from(releases).where(eq(releases.id, releaseId)).get();
  return NextResponse.json({ data: updated });
}

/** Absent expectations are not checked; `null` expects an empty field. */
function matchesExpected(
  row: { title: string | null; changelog: string | null },
  body: { expectedTitle?: string | null; expectedChangelog?: string | null }
): boolean {
  if (body.expectedTitle !== undefined && (row.title ?? null) !== (body.expectedTitle || null)) {
    return false;
  }
  if (
    body.expectedChangelog !== undefined &&
    (row.changelog ?? "") !== (body.expectedChangelog ?? "")
  ) {
    return false;
  }
  return true;
}
