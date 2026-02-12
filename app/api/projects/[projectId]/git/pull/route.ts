import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  FastForwardOnlyPullError,
  getCurrentGitBranch,
  pullGitBranchFfOnly,
} from "@/lib/git/remote";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.gitRepoPath) {
    return NextResponse.json(
      { error: "Project has no git repository path configured." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const remote = typeof body?.remote === "string" ? body.remote : "origin";
  const requestedBranch = typeof body?.branch === "string" ? body.branch : "";
  const branch = requestedBranch.trim() || (await getCurrentGitBranch(project.gitRepoPath));

  try {
    const result = await pullGitBranchFfOnly(project.gitRepoPath, branch, remote);
    return NextResponse.json({
      data: {
        action: "pull",
        projectId,
        remote,
        branch,
        ffOnly: true,
        summary: result.summary,
      },
    });
  } catch (error) {
    if (error instanceof FastForwardOnlyPullError) {
      return NextResponse.json(
        {
          error: error.message,
          data: {
            action: "pull",
            projectId,
            remote,
            branch,
            ffOnly: true,
          },
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to pull branch.",
        data: { action: "pull", projectId, remote, branch, ffOnly: true },
      },
      { status: 500 }
    );
  }
}
