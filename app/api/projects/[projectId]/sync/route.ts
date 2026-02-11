import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { exportArjiJson } from "@/lib/sync/export";
import { importArjiJson } from "@/lib/sync/import";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json();
  const { action } = body as { action: "export" | "import" };

  if (!action || !["export", "import"].includes(action)) {
    return NextResponse.json(
      { error: 'action must be "export" or "import"' },
      { status: 400 }
    );
  }

  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.gitRepoPath) {
    return NextResponse.json(
      { error: "Project has no gitRepoPath configured" },
      { status: 400 }
    );
  }

  try {
    if (action === "export") {
      await exportArjiJson(projectId);
      return NextResponse.json({
        data: { action, path: project.gitRepoPath },
      });
    }

    // action === "import"
    const summary = await importArjiJson(projectId);
    return NextResponse.json({ data: { action, summary } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
