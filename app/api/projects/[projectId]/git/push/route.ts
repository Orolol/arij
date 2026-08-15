import { NextRequest, NextResponse } from "next/server";
import {
  getProjectOr404,
  isErrorResponse,
  errorResponse,
} from "@/lib/api/route-helpers";
import {
  getCurrentGitBranch,
  pushGitBranch,
  PushValidationError,
  validatePushPreconditions,
} from "@/lib/git/remote";
import { writeGitSyncLog } from "@/lib/github/sync-log";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(found)) {
    if (found.status === 400) {
      writeGitSyncLog({
        projectId,
        operation: "push",
        status: "failed",
        branch: null,
        detail: { reason: "missing_git_repo_path" },
      });
    }
    return found;
  }
  const { project } = found;

  const body = await request.json().catch(() => ({}));
  const remote = typeof body?.remote === "string" ? body.remote : "origin";
  const setUpstream = typeof body?.setUpstream === "boolean" ? body.setUpstream : true;
  const requestedBranch = typeof body?.branch === "string" ? body.branch : "";
  const branch = requestedBranch.trim() || (await getCurrentGitBranch(project.gitRepoPath));

  try {
    await validatePushPreconditions(project.gitRepoPath, branch, remote);
    const result = await pushGitBranch(
      project.gitRepoPath,
      branch,
      remote,
      setUpstream
    );
    const summary = {
      pushed: result.pushed.length,
      update: result.update ? 1 : 0,
    };

    writeGitSyncLog({
      projectId,
      operation: "push",
      status: "success",
      branch,
      detail: { remote, setUpstream, ...summary },
    });

    return NextResponse.json({
      data: {
        action: "push",
        projectId,
        remote,
        branch,
        setUpstream,
        summary,
      },
    });
  } catch (error) {
    if (error instanceof PushValidationError) {
      writeGitSyncLog({
        projectId,
        operation: "push",
        status: "failed",
        branch,
        detail: {
          remote,
          setUpstream,
          code: error.code,
          error: error.message,
        },
      });

      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }

    writeGitSyncLog({
      projectId,
      operation: "push",
      status: "failed",
      branch,
      detail: {
        remote,
        setUpstream,
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });

    return errorResponse(error, "Failed to push branch.");
  }
}
