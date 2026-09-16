import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaPrompts } from "@/lib/db/schema";
import { createQaPromptSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

type Params = { params: Promise<{ promptId: string }> };
export async function PATCH(request: NextRequest, { params }: Params) {
  const { promptId } = await params;
  const validated = await validateBody(createQaPromptSchema, request);
  if (isValidationError(validated)) return validated;
  const updated = db.update(qaPrompts).set({ ...validated.data, updatedAt: new Date().toISOString() }).where(eq(qaPrompts.id, promptId)).returning().get();
  return updated ? NextResponse.json({ data: updated }) : NextResponse.json({ error: "QA prompt not found" }, { status: 404 });
}
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { promptId } = await params;
  const deleted = db.delete(qaPrompts).where(eq(qaPrompts.id, promptId)).returning().get();
  return deleted ? NextResponse.json({ data: { id: promptId } }) : NextResponse.json({ error: "QA prompt not found" }, { status: 404 });
}
