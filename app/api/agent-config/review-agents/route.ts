import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customReviewAgents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";

export async function GET() {
  const rows = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.scope, "global"))
    .all();

  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, systemPrompt } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "name is required and must be a string" },
      { status: 400 }
    );
  }

  if (!systemPrompt || typeof systemPrompt !== "string") {
    return NextResponse.json(
      { error: "systemPrompt is required and must be a string" },
      { status: 400 }
    );
  }

  // Check name uniqueness within global scope
  const existing = db
    .select()
    .from(customReviewAgents)
    .where(
      and(
        eq(customReviewAgents.name, name),
        eq(customReviewAgents.scope, "global")
      )
    )
    .get();

  if (existing) {
    return NextResponse.json(
      { error: `A global review agent named "${name}" already exists` },
      { status: 409 }
    );
  }

  // Get max position
  const allGlobal = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.scope, "global"))
    .all();
  const maxPosition = allGlobal.reduce(
    (max, r) => Math.max(max, r.position ?? 0),
    -1
  );

  const now = new Date().toISOString();
  const newRow = {
    id: createId(),
    name,
    systemPrompt,
    scope: "global",
    position: maxPosition + 1,
    isEnabled: 1,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(customReviewAgents).values(newRow).run();

  return NextResponse.json({ data: newRow }, { status: 201 });
}
