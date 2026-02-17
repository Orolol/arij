import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { tryExportArjiJson } from "@/lib/sync/export";
import {
  deleteEpicPermanently,
  ScopedDeleteNotFoundError,
} from "@/lib/planning/permanent-delete";
import { updateEpicSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import type { KanbanStatus } from "@/lib/types/kanban";
import { applyTransition } from "@/lib/workflow/transition-service";
import { emitTicketUpdated, emitTicketDeleted } from "@/lib/events/emit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; epicId: string }> }
) {
  const { projectId, epicId } = await params;

  const validated = await validateBody(updateEpicSchema, request);
  if (isValidationError(validated)) return validated;

  const body = validated.data;

  const existing = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!existing) {
    return NextResponse.json({ error: "Epic not found" }, { status: 404 });
  }

  // Prevent any changes to released epics' status
  if (existing.status === "released" && body.status !== undefined && body.status !== "released") {
    return NextResponse.json(
      { error: "Cannot change status of a released epic. Released tickets cannot be moved." },
      { status: 400 }
    );
  }

  // Validate workflow rules if status is changing
  if (body.status !== undefined && body.status !== existing.status) {
    const result = applyTransition({
      projectId,
      epicId,
      fromStatus: (existing.status ?? "backlog") as KanbanStatus,
      toStatus: body.status as KanbanStatus,
      actor: "user",
      source: "api",
      reason: "Manual status update",
      skipDbUpdate: true, // we update below with all fields
    });
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.status !== undefined) updates.status = body.status;
  if (body.position !== undefined) updates.position = body.position;
  if (body.branchName !== undefined) updates.branchName = body.branchName;

  db.update(epics).set(updates).where(eq(epics.id, epicId)).run();

  const updated = db.select().from(epics).where(eq(epics.id, epicId)).get();

  // Emit update event for non-status changes (status changes already emitted by applyTransition)
  if (!(body.status !== undefined && body.status !== existing.status)) {
    emitTicketUpdated(projectId, epicId, updates);
  }

  tryExportArjiJson(projectId);
  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; epicId: string }> }
) {
  const { projectId, epicId } = await params;

  try {
    deleteEpicPermanently(projectId, epicId);
    emitTicketDeleted(projectId, epicId);
    tryExportArjiJson(projectId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    if (error instanceof ScopedDeleteNotFoundError) {
      return NextResponse.json({ error: "Epic not found" }, { status: 404 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to delete epic: ${message}` },
      { status: 409 },
    );
  }
}
