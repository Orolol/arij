import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, epics, userStories, reviewComments, ticketComments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { tryExportArjiJson } from "@/lib/sync/export";
import simpleGit from "simple-git";
import { emitTicketMoved } from "@/lib/events/emit";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;

  // Validate epic exists and is in review
  const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!epic) {
    return NextResponse.json({ error: "Epic not found" }, { status: 404 });
  }
  if (epic.status !== "review") {
    return NextResponse.json(
      { error: "Epic must be in review status to approve" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // Bulk-resolve all open review comments
  db.update(reviewComments)
    .set({ status: "resolved", updatedAt: now })
    .where(
      and(
        eq(reviewComments.epicId, epicId),
        eq(reviewComments.status, "open")
      )
    )
    .run();

  // Post approval activity comment
  db.insert(ticketComments)
    .values({
      id: createId(),
      epicId,
      author: "user",
      content: "**Review approved.** All review comments resolved.",
      createdAt: now,
    })
    .run();

  // Epic -> done
  db.update(epics)
    .set({ status: "done", updatedAt: now })
    .where(eq(epics.id, epicId))
    .run();

  // All US -> done
  db.update(userStories)
    .set({ status: "done" })
    .where(eq(userStories.epicId, epicId))
    .run();

  // Attempt auto-merge
  let merged = false;
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (project?.gitRepoPath && epic.branchName) {
    try {
      const git = simpleGit(project.gitRepoPath);
      await git.merge([epic.branchName, "--no-ff"]);
      merged = true;
    } catch (e) {
      console.error("[epic-approve] Merge failed:", e);
    }
  }

  emitTicketMoved(projectId, epicId, "review", "done");
  tryExportArjiJson(projectId);

  return NextResponse.json({
    data: {
      approved: true,
      merged,
    },
  });
}
