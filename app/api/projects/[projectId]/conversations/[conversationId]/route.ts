import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatConversations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; conversationId: string }> }
) {
  const { projectId, conversationId } = await params;

  // Validate the conversation belongs to the project
  const conversation = db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.projectId, projectId)
      )
    )
    .get();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Delete conversation (messages cascade via FK)
  db.delete(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .run();

  return NextResponse.json({ data: { deleted: true } });
}
