import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { tryExportArjiJson } from "@/lib/sync/export";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; epicId: string }> }
) {
  const { projectId, epicId } = await params;
  const body = await request.json();

  const existing = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!existing) {
    return NextResponse.json({ error: "Epic not found" }, { status: 404 });
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
  tryExportArjiJson(projectId);
  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; epicId: string }> }
) {
  const { projectId, epicId } = await params;

  const existing = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!existing) {
    return NextResponse.json({ error: "Epic not found" }, { status: 404 });
  }

  db.delete(epics).where(eq(epics.id, epicId)).run();
  tryExportArjiJson(projectId);
  return NextResponse.json({ data: { deleted: true } });
}
