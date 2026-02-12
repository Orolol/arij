import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customReviewAgents } from "@/lib/db/schema";
import { or, eq, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const rows = db
    .select()
    .from(customReviewAgents)
    .where(
      or(
        eq(customReviewAgents.scope, "global"),
        eq(customReviewAgents.scope, projectId)
      )
    )
    .all();

  return NextResponse.json({ data: rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
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

  // Check name uniqueness within project scope
  const existing = db
    .select()
    .from(customReviewAgents)
    .where(
      and(
        eq(customReviewAgents.name, name),
        eq(customReviewAgents.scope, projectId)
      )
    )
    .get();

  if (existing) {
    return NextResponse.json(
      { error: `A review agent named "${name}" already exists for this project` },
      { status: 409 }
    );
  }

  // Get max position within scope
  const allInScope = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.scope, projectId))
    .all();
  const maxPosition = allInScope.reduce(
    (max, r) => Math.max(max, r.position ?? 0),
    -1
  );

  const now = new Date().toISOString();
  const newRow = {
    id: createId(),
    name,
    systemPrompt,
    scope: projectId,
    position: maxPosition + 1,
    isEnabled: 1,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(customReviewAgents).values(newRow).run();

  return NextResponse.json({ data: newRow }, { status: 201 });
}
