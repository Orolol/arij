import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  CloneConflictError,
  CloneFailedError,
  cloneGitHubRepository,
} from "@/lib/git/clone";
import { parseGitHubRepoInput } from "@/lib/git/remote";
import { redactedErrorMessage } from "@/lib/git/redact";
import { getGitHubTokenFromSettings } from "@/lib/github/client";
import { logSyncOperation } from "@/lib/github/sync-log";
import {
  ensureProjectsRoot,
  resolveCloneDestination,
  resolveProjectsRoot,
} from "@/lib/projects/workspace";
import { cloneProjectSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

/**
 * Clone a GitHub repository into the app-managed workspace.
 *
 * Deliberately separate from POST /api/projects/import: that route stays
 * untouched and keeps taking a filesystem path, while the UI gets two honest
 * progress steps ("Cloning…", then "Analyzing…"). Re-submitting the same URL is
 * idempotent — an existing healthy clone is fetched, not re-downloaded, which
 * is what makes resuming an interrupted import instant.
 *
 * Like the import route this is synchronous: a large clone holds the request
 * open for as long as it takes. No new job infrastructure.
 */
export async function POST(request: NextRequest) {
  const validated = await validateBody(cloneProjectSchema, request);
  if (isValidationError(validated)) return validated;

  const { url, projectId } = validated.data;

  const parsed = parseGitHubRepoInput(url);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Not a GitHub repository URL. Use https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo.",
      },
      { status: 400 }
    );
  }

  let projectsRoot: string;
  let destination: string;
  try {
    projectsRoot = ensureProjectsRoot(resolveProjectsRoot());
    destination = resolveCloneDestination(parsed.owner, parsed.repo, projectsRoot);
  } catch (error) {
    return NextResponse.json(
      { error: redactedErrorMessage(error, "Could not resolve the clone destination.") },
      { status: 400 }
    );
  }

  const token = getGitHubTokenFromSettings();

  try {
    const result = await cloneGitHubRepository({
      input: url,
      destination,
      token,
    });

    recordCloneOutcome(projectId, {
      status: "success",
      ownerRepo: result.ownerRepo,
      destination: result.path,
      reused: result.reused,
      destinationState: result.destinationState,
      durationMs: result.durationMs,
      defaultBranch: result.defaultBranch,
    });

    return NextResponse.json({
      data: {
        path: result.path,
        ownerRepo: result.ownerRepo,
        remoteUrl: result.remoteUrl,
        defaultBranch: result.defaultBranch,
        reused: result.reused,
        projectsRoot,
      },
    });
  } catch (error) {
    if (error instanceof CloneConflictError) {
      recordCloneOutcome(projectId, {
        status: "failure",
        ownerRepo: parsed.ownerRepo,
        destination,
        error: error.message,
      });

      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          data: {
            destination: error.destination,
            existingRemote: error.existingRemote,
          },
        },
        { status: 409 }
      );
    }

    const message =
      error instanceof CloneFailedError
        ? error.message
        : redactedErrorMessage(error, `Failed to clone ${parsed.ownerRepo}.`);

    recordCloneOutcome(projectId, {
      status: "failure",
      ownerRepo: parsed.ownerRepo,
      destination,
      error: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Writes the clone audit trail.
 *
 * `git_sync_log.project_id` is a foreign key, so a first-time clone — which
 * happens before the project row exists — has nothing to attach to; those are
 * recorded on the server console instead. Passing `projectId` (re-clone of an
 * existing project) upgrades it to a real `operation = "clone"` row.
 */
function recordCloneOutcome(
  projectId: string | null | undefined,
  detail: Record<string, unknown>
): void {
  console.info("[clone]", detail);

  if (!projectId) return;

  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return;

  logSyncOperation({
    projectId,
    operation: "clone",
    status: detail.status === "success" ? "success" : "failure",
    detail,
  });
}
