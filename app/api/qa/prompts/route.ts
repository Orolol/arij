import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaPrompts } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { createQaPromptSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

export async function GET() {
  const prompts = db
    .select()
    .from(qaPrompts)
    .orderBy(desc(qaPrompts.createdAt))
    .all();

  return NextResponse.json({ data: prompts });
}

export async function POST(request: NextRequest) {
  const validated = await validateBody(createQaPromptSchema, request);
  if (isValidationError(validated)) return validated;

  const name = validated.data.name.trim();
  const prompt = validated.data.prompt.trim();

  const id = createId();
  const now = new Date().toISOString();

  try {
    db.insert(qaPrompts)
      .values({
        id,
        name,
        prompt,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create QA prompt",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ data: { id } }, { status: 201 });
}
