import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaPrompts } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";

export async function GET() {
  const prompts = db
    .select()
    .from(qaPrompts)
    .orderBy(desc(qaPrompts.createdAt))
    .all();

  return NextResponse.json({ data: prompts });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!name || !prompt) {
    return NextResponse.json(
      { error: "Name and prompt are required" },
      { status: 400 },
    );
  }

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
