import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaPrompts } from "@/lib/db/schema";

type Params = { params: Promise<{ promptId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { promptId } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = db
    .select()
    .from(qaPrompts)
    .where(eq(qaPrompts.id, promptId))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  const updates: Record<string, string> = {
    updatedAt: new Date().toISOString(),
  };

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    updates.prompt = body.prompt.trim();
  }

  try {
    db.update(qaPrompts)
      .set(updates)
      .where(eq(qaPrompts.id, promptId))
      .run();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update QA prompt",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ data: { id: promptId } });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { promptId } = await params;

  db.delete(qaPrompts).where(eq(qaPrompts.id, promptId)).run();

  return NextResponse.json({ data: { deleted: true } });
}
