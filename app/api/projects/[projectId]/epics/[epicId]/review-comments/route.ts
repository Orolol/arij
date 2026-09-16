import { z } from "zod";
import { validateBody } from "@/lib/validation/validate";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reviewComments, ticketComments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { getEpicOr404, isErrorResponse } from "@/lib/api/route-helpers";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;

  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  const comments = db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.epicId, epicId))
    .orderBy(reviewComments.createdAt)
    .all();

  return NextResponse.json({ data: comments });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;
  const body = await request.json();

  if (!body.filePath || body.lineNumber == null || !body.body) {
    return NextResponse.json(
      { error: "filePath, lineNumber, and body are required" },
      { status: 400 }
    );
  }

  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

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
  const { projectId, epicId } = await params;
  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;
  const validated = await validateBody(z.object({ id: z.string().min(1), body: z.string().min(1).max(10000).optional(), status: z.enum(["open", "resolved", "dismissed"]).optional(), dismissedReason: z.string().trim().min(1).max(4000).optional() }), request);
  if (isErrorResponse(validated)) return validated;
  const body = validated.data;

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
  if (body.status === "dismissed" && !body.dismissedReason) {
    return NextResponse.json({ error: "A dismissal reason is required" }, { status: 400 });
  }
  if (body.status !== undefined) {
    updates.status = body.status;
    updates.dismissedReason = body.status === "dismissed" ? body.dismissedReason : null;
  }

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
  const { projectId, epicId } = await params;
  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;
  const validated = await validateBody(z.object({ id: z.string().min(1), body: z.string().min(1).max(10000).optional(), status: z.enum(["open", "resolved", "dismissed"]).optional(), dismissedReason: z.string().trim().min(1).max(4000).optional() }), request);
  if (isErrorResponse(validated)) return validated;
  const body = validated.data;

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
