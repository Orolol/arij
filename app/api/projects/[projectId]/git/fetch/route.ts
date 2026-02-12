import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { fetchGitRemote } from "@/lib/git/remote";

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
  const branch = typeof body?.branch === "string" ? body.branch : null;

  try {
    const result = await fetchGitRemote(project.gitRepoPath, remote);
    return NextResponse.json({
      data: {
        action: "fetch",
        projectId,
        remote,
        branch,
        summary: {
          branches: result.branches.length,
          tags: result.tags.length,
          updates: result.updated.length,
          deleted: result.deleted.length,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch remote.",
        data: { action: "fetch", projectId, remote, branch },
      },
      { status: 500 }
    );
  }
}
