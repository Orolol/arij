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
import {
  getGitHubTokenFromSettings,
  validateGitHubToken,
} from "@/lib/github/client";
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
  workspace_unavailable: 500,
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

/**
 * `Repository not found` is what GitHub answers both for a repository a token
 * may not see and for a token it will not accept at all, so git alone cannot
 * tell the two apart. Ask the API which it is, so an expired PAT surfaces as
 * 401 instead of a misleading 404.
 *
 * Only an authoritative 401 flips the verdict: a network failure or a
 * rate-limited 403 must leave the original 404 — and its actionable message —
 * intact.
 */
async function disambiguateNotFound(
  error: CloneError,
  token: string | null
): Promise<CloneError> {
  if (error.code !== "not_found" || !token) return error;

  try {
    const check = await validateGitHubToken(token);
    if (!check.valid && check.status === 401) {
      return new CloneError(
        "auth_failed",
        "GitHub rejected the stored PAT, so the repository could not be reached. Update it in Settings → GitHub PAT and retry.",
        { ...error.details, tokenRejected: true }
      );
    }
  } catch {
    // Best effort only — an unreachable API must not rewrite the verdict.
  }

  return error;
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
  const startedAt = Date.now();

  // Set outside the boundary so the failure log can still name the destination
  // and redact against the token when setup itself is what failed.
  let dest: string | null = null;
  let token: string | null = null;

  try {
    let timeoutMs: number;
    try {
      dest = cloneDestination(owner, repo, ensureProjectsRoot());
      // Read once so the same value drives the command and the failure message.
      token = getGitHubTokenFromSettings();
      timeoutMs = resolveCloneTimeoutMs();
    } catch (error) {
      throw new CloneError(
        "workspace_unavailable",
        `Could not prepare the clone directory: ${redactGitError(error)}`
      );
    }

    const result = await cloneRepository({
      cloneUrl,
      dest,
      branch: cleanBranch,
      token,
      expectedOwnerRepo: ownerRepo,
      timeoutMs,
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
    const secrets = token ? [token] : [];
    const raised =
      error instanceof CloneError
        ? error
        : new CloneError("clone_failed", redactGitError(error, secrets));
    const cloneError = await disambiguateNotFound(raised, token);
    const message = redactGitError(cloneError.message, secrets);
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
