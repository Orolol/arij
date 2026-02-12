import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customReviewAgents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const existing = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.id, agentId))
    .get();

  if (!existing) {
    return NextResponse.json(
      { error: "Review agent not found" },
      { status: 404 }
    );
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 }
      );
    }
    // Check name uniqueness within same scope
    if (body.name !== existing.name) {
      const duplicate = db
        .select()
        .from(customReviewAgents)
        .where(
          and(
            eq(customReviewAgents.name, body.name),
            eq(customReviewAgents.scope, existing.scope)
          )
        )
        .get();
      if (duplicate) {
        return NextResponse.json(
          { error: `A review agent named "${body.name}" already exists in this scope` },
          { status: 409 }
        );
      }
    }
    updates.name = body.name;
  }

  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== "string") {
      return NextResponse.json(
        { error: "systemPrompt must be a string" },
        { status: 400 }
      );
    }
    updates.systemPrompt = body.systemPrompt;
  }

  if (body.isEnabled !== undefined) {
    updates.isEnabled = body.isEnabled ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  updates.updatedAt = new Date().toISOString();

  db.update(customReviewAgents)
    .set(updates)
    .where(eq(customReviewAgents.id, agentId))
    .run();

  const updated = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.id, agentId))
    .get();

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const existing = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.id, agentId))
    .get();

  if (!existing) {
    return NextResponse.json(
      { error: "Review agent not found" },
      { status: 404 }
    );
  }

  db.delete(customReviewAgents)
    .where(eq(customReviewAgents.id, agentId))
    .run();

  return NextResponse.json({ data: { deleted: true } });
}
