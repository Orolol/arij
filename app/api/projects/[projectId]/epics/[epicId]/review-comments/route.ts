import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reviewComments, epics, ticketComments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { epicId } = await params;

  const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!epic) {
    return NextResponse.json({ error: "Epic not found" }, { status: 404 });
  }

  const comments = db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.epicId, epicId))
    .orderBy(reviewComments.createdAt)
    .all();

  return NextResponse.json({ data: comments });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { epicId } = await params;
  const body = await request.json();

  if (!body.filePath || body.lineNumber == null || !body.body) {
    return NextResponse.json(
      { error: "filePath, lineNumber, and body are required" },
      { status: 400 }
    );
  }

  const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!epic) {
    return NextResponse.json({ error: "Epic not found" }, { status: 404 });
  }

  const id = createId();
  const now = new Date().toISOString();

  db.insert(reviewComments)
    .values({
      id,
      epicId,
      filePath: body.filePath,
      lineNumber: body.lineNumber,
      body: body.body,
      author: body.author || "user",
      status: "open",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Also post as a ticket activity comment for centralized history
  db.insert(ticketComments)
    .values({
      id: createId(),
      epicId,
      author: "user",
      content: `**Review comment** on \`${body.filePath}:${body.lineNumber}\`:\n\n${body.body}`,
      createdAt: now,
    })
    .run();

  const comment = db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.id, id))
    .get();

  return NextResponse.json({ data: comment }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { epicId } = await params;
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const comment = db
    .select()
    .from(reviewComments)
    .where(
      and(eq(reviewComments.id, body.id), eq(reviewComments.epicId, epicId))
    )
    .get();

  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.body !== undefined) updates.body = body.body;
  if (body.status !== undefined) updates.status = body.status;

  db.update(reviewComments)
    .set(updates)
    .where(eq(reviewComments.id, body.id))
    .run();

  const updated = db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.id, body.id))
    .get();

  return NextResponse.json({ data: updated });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { epicId } = await params;
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const comment = db
    .select()
    .from(reviewComments)
    .where(
      and(eq(reviewComments.id, body.id), eq(reviewComments.epicId, epicId))
    )
    .get();

  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  db.delete(reviewComments).where(eq(reviewComments.id, body.id)).run();

  return NextResponse.json({ data: { deleted: true } });
}
