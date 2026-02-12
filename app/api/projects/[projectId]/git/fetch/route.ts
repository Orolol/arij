import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchRemote } from "@/lib/git/remote";
import { logSyncOperation } from "@/lib/github/sync-log";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    return NextResponse.json(
      { error: "not_found", message: "Project not found." },
      { status: 404 }
    );
  }

  if (!project.gitRepoPath) {
    return NextResponse.json(
      { error: "not_configured", message: "No git repository path configured for this project." },
      { status: 400 }
    );
  }

  // Check that GitHub config exists
  const pat = db
    .select()
    .from(settings)
    .where(eq(settings.key, "github_pat"))
    .get();

  if (!pat) {
    return NextResponse.json(
      { error: "not_configured", message: "GitHub PAT not configured. Set it in Settings." },
      { status: 400 }
    );
  }

  try {
    await fetchRemote(project.gitRepoPath);

    logSyncOperation({
      projectId,
      operation: "fetch",
      status: "success",
    });

    return NextResponse.json({ data: { success: true } });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Fetch failed";

    logSyncOperation({
      projectId,
      operation: "fetch",
      status: "failure",
      detail,
    });

    return NextResponse.json(
      { error: "fetch_failed", message: detail },
      { status: 500 }
    );
  }
}
