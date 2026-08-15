import { NextRequest, NextResponse } from "next/server";
import {
  getProjectOr404,
  isErrorResponse,
  errorResponse,
} from "@/lib/api/route-helpers";
import { getBranchSyncStatus, getCurrentGitBranch } from "@/lib/git/remote";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(found)) return found;
  const { project } = found;

  const remote = request.nextUrl.searchParams.get("remote") || "origin";
  const requestedBranch = request.nextUrl.searchParams.get("branch")?.trim() || "";
  const branch = requestedBranch || (await getCurrentGitBranch(project.gitRepoPath));

  try {
    const status = await getBranchSyncStatus(project.gitRepoPath, branch, remote);
    return NextResponse.json({
      data: {
        action: "status",
        projectId,
        remote: status.remote,
        branch: status.branch,
        remoteBranch: status.remoteBranch,
        ahead: status.ahead,
        behind: status.behind,
        hasRemoteBranch: status.hasRemoteBranch,
      },
    });
  } catch (error) {
    return errorResponse(error, "Failed to read branch status.");
  }
}
