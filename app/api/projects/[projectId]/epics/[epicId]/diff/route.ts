import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, epics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getWorktreeDiff } from "@/lib/git/diff";
import { createWorktree, isGitRepo } from "@/lib/git/manager";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;

  const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!epic) {
    return NextResponse.json({ error: "Epic not found" }, { status: 404 });
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.gitRepoPath) {
    return NextResponse.json(
      { error: "Project has no git repository configured" },
      { status: 400 }
    );
  }

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
    const files = await getWorktreeDiff(worktreePath);
    return NextResponse.json({ data: { files } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to generate diff";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
