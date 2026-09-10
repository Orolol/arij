import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { convertToMarkdown } from "@/lib/converters";
import { isInternalMemoryDocKind } from "@/lib/documents/memory-constants";
import {
  documentFileAbsolutePath,
  documentImageRelativePath,
  projectDocumentsDirectory,
} from "@/lib/documents/document-paths";
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENT_UPLOAD_LABEL,
  oversizedDocumentUploadReason,
} from "@/lib/documents/upload-constants";
import fs from "fs";

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
]);

type DocumentKind = "text" | "image";

function resolveDocumentKind(file: File): DocumentKind {
  if (IMAGE_MIME_TYPES.has(file.type) || file.type.startsWith("image/")) {
    return "image";
  }
  return "text";
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildImageStoragePath(projectId: string, id: string, fileName: string): {
  absolutePath: string;
  relativePath: string;
} {
  fs.mkdirSync(projectDocumentsDirectory(projectId), { recursive: true });
  const diskName = `${id}-${safeFileName(fileName)}`;
  return {
    absolutePath: documentFileAbsolutePath(projectId, diskName),
    relativePath: documentImageRelativePath(projectId, diskName),
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  // The memory documents (live + pre-dream archive) share this table but are
  // not uploads — they have their own editor card, and listing them here would
  // put a delete button next to the project's learned conventions.
  const result = db
    .select()
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .orderBy(documents.createdAt)
    .all()
    .filter((doc) => !isInternalMemoryDocKind(doc.kind));

  return NextResponse.json({ data: result });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  let bytesRead = 0;
  let formData: FormData;
  try {
    if (request.body) {
      const countingStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytesRead += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });
      formData = await new Response(request.body.pipeThrough(countingStream), {
        headers: request.headers,
      }).formData();
    } else {
      formData = await request.formData();
    }
  } catch {
    // A body over the platform's request cap arrives truncated, so parsing it
    // throws here — before the size guard below ever sees the file. Left
    // unhandled this is the one rejection that answers with a bare 500 and an
    // empty body, which is exactly the case the guard exists to explain, so
    // the limit is named here as well.
    const declared = Number(request.headers.get("content-length"));
    const declaredBytes = Number.isFinite(declared) && declared > 0 ? declared : null;

    // Distinguish confirmed overflow from a generic parse failure:
    // 1. Declared content-length exceeding the document limit
    // 2. Or observed bytes read from the stream exceeding the document limit
    const isOversized =
      (declaredBytes !== null && declaredBytes > MAX_DOCUMENT_UPLOAD_BYTES) ||
      bytesRead > MAX_DOCUMENT_UPLOAD_BYTES;

    if (isOversized) {
      const bodyBytes = declaredBytes ?? (bytesRead > 0 ? bytesRead : null);
      return NextResponse.json(
        { error: oversizedDocumentUploadReason(bodyBytes) },
        { status: 413 }
      );
    }

    // Small or unverified body that failed to parse as valid multipart:
    // return 400 without blaming the size limit.
    return NextResponse.json(
      { error: "Could not read the upload. Expected a multipart form body." },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    const megabytes = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      {
        error: `File too large (${megabytes}MB). Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`,
      },
      { status: 413 }
    );
  }

  const duplicate = db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        sql`LOWER(${documents.originalFilename}) = LOWER(${file.name})`
      )
    )
    .get();
  if (duplicate) {
    return NextResponse.json(
      { error: `A document named "${file.name}" already exists in this project.` },
      { status: 409 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const kind = resolveDocumentKind(file);
  const id = createId();
  const now = new Date().toISOString();

  let markdownContent: string | null = null;
  let imagePath: string | null = null;

  if (kind === "text") {
    try {
      markdownContent = await convertToMarkdown(buffer, mimeType, file.name);
    } catch (e) {
      return NextResponse.json(
        { error: `Conversion failed: ${e instanceof Error ? e.message : "Unknown error"}` },
        { status: 400 }
      );
    }
  } else {
    try {
      const { absolutePath, relativePath } = buildImageStoragePath(projectId, id, file.name);
      fs.writeFileSync(absolutePath, buffer);
      imagePath = relativePath;
    } catch (e) {
      return NextResponse.json(
        { error: `Image storage failed: ${e instanceof Error ? e.message : "Unknown error"}` },
        { status: 500 }
      );
    }
  }

  db.insert(documents)
    .values({
      id,
      projectId,
      originalFilename: file.name,
      kind,
      markdownContent,
      imagePath,
      mimeType,
      sizeBytes: file.size,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  return NextResponse.json({ data: doc }, { status: 201 });
}
