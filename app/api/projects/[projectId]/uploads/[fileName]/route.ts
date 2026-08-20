import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAllowedImageMimeType } from "@/lib/uploads/image-attachments";
import {
  isServableUploadFileName,
  uploadsDirectoryFor,
} from "@/lib/uploads/ticket-images";
import path from "path";
import fs from "fs";

/**
 * Serves one of a project's uploaded images by file name — how a bug ticket's
 * stored `data/uploads/<projectId>/<file>` paths become `<img>` sources.
 *
 * The chat reaches the same files through `/chat/uploads/<attachmentId>`, but
 * a bug stores paths rather than ids and the id is not recoverable from the
 * disk name (`<id>-<name>` where both halves may contain `-`), hence this
 * second entry point rather than a lookup the caller cannot perform.
 *
 * Only files that went through `POST /chat/upload` are servable: the name must
 * match a `chat_attachments` row for *this* project's upload directory, and
 * the recorded MIME type must still be an allowed image. A hand-edited
 * `epics.images` therefore cannot turn this into a read-any-file endpoint, and
 * a row whose type is not an image cannot be served back as one.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; fileName: string }> }
) {
  const { projectId, fileName } = await params;

  if (!isServableUploadFileName(fileName)) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const relativePath = `${uploadsDirectoryFor(projectId)}/${fileName}`;

  const attachment = db
    .select()
    .from(chatAttachments)
    .where(eq(chatAttachments.filePath, relativePath))
    .get();

  if (!attachment || !isAllowedImageMimeType(attachment.mimeType)) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const absolutePath = path.join(process.cwd(), relativePath);

  if (!fs.existsSync(absolutePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(absolutePath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(fileBuffer.length),
      // The name carries a nanoid, so the bytes behind a URL never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
