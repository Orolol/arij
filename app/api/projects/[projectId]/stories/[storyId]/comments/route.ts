import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketComments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { getStoryOr404, isErrorResponse } from "@/lib/api/route-helpers";
import {
  MentionResolutionError,
  validateMentionsExist,
} from "@/lib/documents/mentions";

type Params = { params: Promise<{ projectId: string; storyId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, storyId } = await params;

  const found = getStoryOr404(projectId, storyId);
  if (isErrorResponse(found)) return found;

  const comments = db
    .select()
    .from(ticketComments)
    .where(eq(ticketComments.userStoryId, storyId))
    .orderBy(ticketComments.createdAt)
    .all();

  return NextResponse.json({ data: comments });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId, storyId } = await params;
  const body = await request.json().catch(() => ({}));

  if (!body.content || !body.author) {
    return NextResponse.json(
      { error: "author and content are required" },
      { status: 400 }
    );
  }

  try {
    validateMentionsExist({
      projectId,
      textSources: [body.content],
    });
  } catch (error) {
    if (error instanceof MentionResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const found = getStoryOr404(projectId, storyId);
  if (isErrorResponse(found)) return found;

  const id = createId();
  const now = new Date().toISOString();

  db.insert(ticketComments)
    .values({
      id,
      userStoryId: storyId,
      author: body.author,
      content: body.content,
      agentSessionId: body.agentSessionId || null,
      createdAt: now,
    })
    .run();

  const comment = db
    .select()
    .from(ticketComments)
    .where(eq(ticketComments.id, id))
    .get();

  return NextResponse.json({ data: comment }, { status: 201 });
}
