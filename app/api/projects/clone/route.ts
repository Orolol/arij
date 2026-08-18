import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  CloneError,
  cloneRepository,
  redactGitError,
  type CloneErrorCode,
} from "@/lib/git/clone";
import {
  CLONE_TIMEOUT_SETTING_KEY,
  DEFAULT_CLONE_TIMEOUT_MS,
  parseCloneTimeoutSetting,
} from "@/lib/git/clone-constants";
import { parseGitHubRepoInput } from "@/lib/git/remote";
import { getGitHubTokenFromSettings } from "@/lib/github/client";
import { writeGitSyncLog } from "@/lib/github/sync-log";
import { cloneDestination, ensureProjectsRoot } from "@/lib/projects/workspace";
import { cloneProjectSchema } from "@/lib/validation/schemas";
import { isValidationError, validateBody } from "@/lib/validation/validate";

/**
 * POST /api/projects/clone
 *
 * Clones a GitHub repository into `<projects_root>/<owner>-<repo>` and hands
 * the path back so the caller can run the existing, untouched import pipeline
 * (`POST /api/projects/import`) against it. Split from the import route on
 * purpose: analysis stays unaware of cloning, and the UI gets two honest
 * progress steps instead of one opaque spinner.
 */

const STATUS_BY_CODE: Record<CloneErrorCode, number> = {
  invalid_input: 400,
  branch_not_found: 400,
  auth_failed: 401,
  not_found: 404,
  conflict: 409,
  clone_failed: 500,
  network: 502,
  timeout: 504,
};

function resolveCloneTimeoutMs(): number {
  try {
    const row = db
      .select()
      .from(settings)
      .where(eq(settings.key, CLONE_TIMEOUT_SETTING_KEY))
      .get();
    return (
      (row ? parseCloneTimeoutSetting(row.value) : null) ??
      DEFAULT_CLONE_TIMEOUT_MS
    );
  } catch {
    return DEFAULT_CLONE_TIMEOUT_MS;
  }
}

export async function POST(request: NextRequest) {
  const validated = await validateBody(cloneProjectSchema, request);
  if (isValidationError(validated)) return validated;

  const { url, branch } = validated.data;

  const parsed = parseGitHubRepoInput(url);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Could not read a GitHub repository from that input. Use https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo.",
      },
      { status: 400 }
    );
  }

  const { owner, repo, ownerRepo, cloneUrl } = parsed;
  const cleanBranch = branch?.trim() || null;

  let dest: string;
  try {
    dest = cloneDestination(owner, repo, ensureProjectsRoot());
  } catch (error) {
    const message = redactGitError(error);
    console.error("[projects/clone] workspace root unavailable:", message);
    return NextResponse.json(
      { error: `Could not prepare the clone directory: ${message}` },
      { status: 500 }
    );
  }

  // Read once so the same value drives the command and the failure message.
  const token = getGitHubTokenFromSettings();
  const startedAt = Date.now();

  try {
    const result = await cloneRepository({
      cloneUrl,
      dest,
      branch: cleanBranch,
      token,
      expectedOwnerRepo: ownerRepo,
      timeoutMs: resolveCloneTimeoutMs(),
    });

    writeGitSyncLog({
      projectId: null,
      operation: "clone",
      status: "success",
      branch: result.defaultBranch,
      detail: {
        ownerRepo,
        path: result.path,
        remoteUrl: cloneUrl,
        reused: result.reused,
        durationMs: result.durationMs,
        authenticated: !!token,
      },
    });

    return NextResponse.json(
      {
        data: {
          path: result.path,
          ownerRepo,
          remoteUrl: cloneUrl,
          defaultBranch: result.defaultBranch,
          reused: result.reused,
        },
      },
      { status: result.reused ? 200 : 201 }
    );
  } catch (error) {
    // Every string leaving this block goes through the redactor: the PAT must
    // reach neither the response, nor the console, nor git_sync_log.
    const cloneError =
      error instanceof CloneError
        ? error
        : new CloneError("clone_failed", redactGitError(error, token ? [token] : []));
    const message = redactGitError(cloneError.message, token ? [token] : []);
    const status = STATUS_BY_CODE[cloneError.code] ?? 500;

    writeGitSyncLog({
      projectId: null,
      operation: "clone",
      status: "failure",
      branch: cleanBranch,
      detail: {
        ownerRepo,
        path: dest,
        remoteUrl: cloneUrl,
        code: cloneError.code,
        error: message,
        durationMs: Date.now() - startedAt,
        authenticated: !!token,
      },
    });

    console.error("[projects/clone] clone failed:", {
      ownerRepo,
      code: cloneError.code,
      error: message,
    });

    return NextResponse.json({ error: message, code: cloneError.code }, { status });
  }
}
