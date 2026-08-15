import { NextResponse } from "next/server";
import {
  getProjectOr404,
  isErrorResponse,
  errorResponse,
} from "@/lib/api/route-helpers";
import { detectGitHubRemote } from "@/lib/git/remote";
import { writeGitSyncLog } from "@/lib/github/sync-log";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(found)) {
    if (found.status === 400) {
      writeGitSyncLog({
        projectId,
        operation: "detect",
        status: "failed",
        detail: { reason: "missing_git_repo_path" },
      });
    }
    return found;
  }
  const { project } = found;

  try {
    const detected = await detectGitHubRemote(project.gitRepoPath);
    if (!detected) {
      writeGitSyncLog({
        projectId,
        operation: "detect",
        status: "success",
        detail: { detected: false },
      });

      return NextResponse.json({ data: { detected: false } });
    }

    writeGitSyncLog({
      projectId,
      operation: "detect",
      status: "success",
      detail: {
        detected: true,
        ownerRepo: detected.ownerRepo,
        remoteName: detected.remoteName,
        remoteUrl: detected.remoteUrl,
      },
    });

    return NextResponse.json({
      data: {
        detected: true,
        owner: detected.owner,
        repo: detected.repo,
        ownerRepo: detected.ownerRepo,
        remoteName: detected.remoteName,
        remoteUrl: detected.remoteUrl,
      },
    });
  } catch (error) {
    writeGitSyncLog({
      projectId,
      operation: "detect",
      status: "failed",
      detail: {
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });

    return errorResponse(error, "Failed to inspect git remotes for this project.");
  }
}
