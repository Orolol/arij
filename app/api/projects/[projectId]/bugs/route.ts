import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { tryExportArjiJson } from "@/lib/sync/export";
import { uploadFileNameFromPath } from "@/lib/uploads/ticket-images";

/**
 * `images` is stored verbatim as JSON and read back by the ticket panel, which
 * can only display this project's own uploads. Accepting anything else would
 * leave the column holding a path that renders as nothing — so the write side
 * is held to exactly what the read side can serve.
 */
function invalidImagesReason(images: unknown, projectId: string): string | null {
  if (images === undefined || images === null) return null;

  if (!Array.isArray(images)) {
    return "images must be an array of upload paths";
  }

  // findIndex, not find: a literal `undefined` member is itself invalid, and
  // find() would report it as "nothing wrong here".
  const offender = images.findIndex(
    (image) => uploadFileNameFromPath(image, projectId) === null
  );
  if (offender !== -1) {
    return `Not an upload of this project: ${JSON.stringify(images[offender])}`;
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json();
  const now = new Date().toISOString();

  if (!body.title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const imagesError = invalidImagesReason(body.images, projectId);
  if (imagesError) {
    return NextResponse.json({ error: imagesError }, { status: 400 });
  }

  const maxPos = db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(epics)
    .where(and(eq(epics.projectId, projectId), eq(epics.status, "backlog")))
    .get();

  const id = createId();

  db.insert(epics)
    .values({
      id,
      projectId,
      title: body.title,
      description: body.description || null,
      priority: body.priority ?? 2,
      status: "backlog",
      position: (maxPos?.max ?? -1) + 1,
      type: "bug",
      linkedEpicId: body.linkedEpicId || null,
      images: body.images ? JSON.stringify(body.images) : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const bug = db.select().from(epics).where(eq(epics.id, id)).get();
  tryExportArjiJson(projectId);
  return NextResponse.json({ data: bug }, { status: 201 });
}
