import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketReadCursors } from "@/lib/db/schema";
import { markInboxReadSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

/**
 * POST /api/inbox/read { epicId } — move the epic's read cursor to now.
 *
 * Fired when the user opens a ticket (EpicDetail mount) or replies from the
 * inbox. Cursors are pure bookkeeping with no FK to epics (see schema), so
 * the epic's existence is deliberately not checked: a cursor for a deleted
 * epic is harmless and joins simply never see it.
 */
export async function POST(request: NextRequest) {
  const validated = await validateBody(markInboxReadSchema, request);
  if (isValidationError(validated)) return validated;

  const { epicId } = validated.data;
  const now = new Date().toISOString();

  db.insert(ticketReadCursors)
    .values({ epicId, lastReadAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: ticketReadCursors.epicId,
      set: { lastReadAt: now, updatedAt: now },
    })
    .run();

  return NextResponse.json({ data: { ok: true, epicId, lastReadAt: now } });
}
