import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatConversations, chatMessages } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  let conversations = db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.projectId, projectId))
    .orderBy(chatConversations.createdAt)
    .all();

  // Auto-create a default "Brainstorm" conversation if none exist
  if (conversations.length === 0) {
    const id = createId();
    const now = new Date().toISOString();

    db.insert(chatConversations)
      .values({
        id,
        projectId,
        type: "brainstorm",
        label: "Brainstorm",
        createdAt: now,
      })
      .run();

    // Backfill existing orphan messages
    db.update(chatMessages)
      .set({ conversationId: id })
      .where(
        and(
          eq(chatMessages.projectId, projectId),
          isNull(chatMessages.conversationId)
        )
      )
      .run();

    conversations = db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.projectId, projectId))
      .orderBy(chatConversations.createdAt)
      .all();
  }

  return NextResponse.json({ data: conversations });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json();

  const id = createId();
  const now = new Date().toISOString();

  db.insert(chatConversations)
    .values({
      id,
      projectId,
      type: body.type || "brainstorm",
      label: body.label || "Brainstorm",
      epicId: body.epicId || null,
      provider: body.provider || "claude-code",
      createdAt: now,
    })
    .run();

  const conversation = db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, id))
    .get();

  return NextResponse.json({ data: conversation });
}
