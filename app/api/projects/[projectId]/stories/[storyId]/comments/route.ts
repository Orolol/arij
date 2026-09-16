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
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { createTicketCommentSchema } from "@/lib/validation/schemas";

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
  const validated = await validateBody(createTicketCommentSchema, request);
  if (isValidationError(validated)) return validated;
  const body = validated.data;

  // User input only: an agent comment naming a codebase file (@src/foo.ts) is
  // not an Arij document reference and must not bounce. Same rule as
  // app/api/mcp/post-comment, which agents use directly.
  if (body.author !== "agent") {
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
