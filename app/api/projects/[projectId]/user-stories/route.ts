import {
  getEpicOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { db } from "@/lib/db";
import { userStories } from "@/lib/db/schema";
import { tryExportArjiJson } from "@/lib/sync/export";
import { createId } from "@/lib/utils/nanoid";
import { createStorySchema } from "@/lib/validation/schemas";
import { isValidationError, validateBody } from "@/lib/validation/validate";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const epicId = request.nextUrl.searchParams.get("epicId");

  if (!epicId) {
    return NextResponse.json({ error: "epicId query param is required" }, { status: 400 });
  }

  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;

  const result = db
    .select()
    .from(userStories)
    .where(eq(userStories.epicId, epicId))
    .orderBy(userStories.position)
    .all();

  return NextResponse.json({ data: result });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(createStorySchema, request);
  if (isValidationError(validated)) return validated;

  const body = validated.data;

  // Validate the parent epic exists and belongs to this project
  const foundEpic = getEpicOr404(projectId, body.epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;

  const maxPos = db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(userStories)
    .where(eq(userStories.epicId, body.epicId))
    .get();

  const id = createId();

  db.insert(userStories)
    .values({
      id,
      epicId: body.epicId,
      title: body.title,
      description: body.description || null,
      acceptanceCriteria: body.acceptanceCriteria || null,
      status: body.status || "todo",
      position: (maxPos?.max ?? -1) + 1,
      createdAt: new Date().toISOString(),
    })
    .run();

  const us = db.select().from(userStories).where(eq(userStories.id, id)).get();
  tryExportArjiJson(projectId);
  return NextResponse.json({ data: us }, { status: 201 });
}

