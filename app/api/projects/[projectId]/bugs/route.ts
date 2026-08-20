import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { tryExportArjiJson } from "@/lib/sync/export";
import { uploadFileNameFromPath } from "@/lib/uploads/ticket-images";
import { lookupServableUpload } from "@/lib/uploads/servable-uploads";

/**
 * `images` is stored verbatim as JSON and read back by the ticket panel, which
 * displays a path only if the uploads route will serve it. Accepting anything
 * else would leave the column holding a reference that renders as a broken
 * thumbnail and points an agent at a file that is not there — so the write side
 * is held to exactly what the read side can serve, by asking the read side.
 *
 * A well-formed path is not enough: `data/uploads/<projectId>/never-uploaded.png`
 * has the right shape and no bytes behind it. Only a registered upload passes.
 */
function invalidImagesReason(images: unknown, projectId: string): string | null {
  if (images === undefined || images === null) return null;

  if (!Array.isArray(images)) {
    return "images must be an array of upload paths";
  }

  // A plain loop, not .find(): a literal `undefined` member is itself invalid,
  // and find() would report it as "nothing wrong here".
  for (const image of images) {
    const fileName = uploadFileNameFromPath(image, projectId);
    if (fileName === null) {
      return `Not an upload of this project: ${JSON.stringify(image)}`;
    }

    const upload = lookupServableUpload(projectId, fileName);
    if (!upload.servable) {
      return upload.reason === "missing-on-disk"
        ? `Upload is no longer on disk: ${JSON.stringify(image)}`
        : `No such upload: ${JSON.stringify(image)}`;
    }
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
