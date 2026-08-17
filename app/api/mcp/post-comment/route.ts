/**
 * POST /api/mcp/post-comment — the mcp__arij__post_comment tool.
 *
 * Inserts an agent-authored comment into the ticket's activity feed, linked
 * to the calling session. Deliberately does NOT run mention validation
 * (validateMentionsExist) — that guard exists for user input in the UI
 * comments route; an agent comment that happens to contain an @word must not
 * bounce.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ticketComments } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { isErrorResponse } from "@/lib/api/route-helpers";
import { validateBody } from "@/lib/validation/validate";
import { requireMcpToken, resolveTicketForToken } from "@/lib/mcp/http-auth";

const bodySchema = z
  .object({
    body: z.string().min(1).max(8000),
    ticket_id: z.string().min(1).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const auth = requireMcpToken(request);
  if (isErrorResponse(auth)) return auth;

  const validated = await validateBody(bodySchema, request);
  if (isErrorResponse(validated)) return validated;
  const body = validated.data;

  const found = resolveTicketForToken(auth, body.ticket_id);
  if (isErrorResponse(found)) return found;
  const { epic } = found;

  const commentId = createId();
  db.insert(ticketComments)
    .values({
      id: commentId,
      epicId: epic.id,
      author: "agent",
      content: body.body,
      agentSessionId: auth.sessionId,
      createdAt: new Date().toISOString(),
    })
    .run();

  return NextResponse.json({ data: { commentId } });
}
