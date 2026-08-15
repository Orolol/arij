import { NextRequest, NextResponse } from "next/server";
import { getWorktreeDiff } from "@/lib/git/diff";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import {
  errorResponse,
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;

  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;

  const foundProject = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(foundProject)) return foundProject;
  const { project } = foundProject;

  if (!epic.branchName) {
    return NextResponse.json(
      { error: "Epic has no branch — nothing to diff" },
      { status: 400 }
    );
  }

  const isRepo = await isGitRepo(project.gitRepoPath);
  if (!isRepo) {
    return NextResponse.json(
      { error: "Project path is not a git repository" },
      { status: 400 }
    );
  }

  // Ensure worktree exists
  const { worktreePath } = await createWorktree(
    project.gitRepoPath,
    epic.id,
    epic.title
  );

  try {
    const result = await getWorktreeDiff(worktreePath);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error, "Failed to generate diff");
  }
}
