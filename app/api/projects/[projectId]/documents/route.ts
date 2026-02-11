import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { convertToMarkdown } from "@/lib/converters";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const result = db
    .select()
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .orderBy(documents.createdAt)
    .all();

  return NextResponse.json({ data: result });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  let contentMd: string;
  try {
    contentMd = await convertToMarkdown(buffer, mimeType, file.name);
  } catch (e) {
    return NextResponse.json(
      { error: `Conversion failed: ${e instanceof Error ? e.message : "Unknown error"}` },
      { status: 400 }
    );
  }

  const id = createId();

  db.insert(documents)
    .values({
      id,
      projectId,
      name: file.name,
      contentMd,
      mimeType,
      createdAt: new Date().toISOString(),
    })
    .run();

  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  return NextResponse.json({ data: doc }, { status: 201 });
}
