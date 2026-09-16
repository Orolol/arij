import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages, chatAttachments } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * A conversation's (or a project's) chat history. Sending goes through
 * POST ./stream only: the non-stream POST that used to live here had no caller
 * left and had drifted from the stream route (project-wide history in the
 * prompt, no conversation status, no title, no tool channel).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const conversationId = request.nextUrl.searchParams.get("conversationId");

  const conditions = [eq(chatMessages.projectId, projectId)];
  if (conversationId) {
    conditions.push(eq(chatMessages.conversationId, conversationId));
  }

  const messages = db
    .select()
    .from(chatMessages)
    .where(and(...conditions))
    .orderBy(chatMessages.createdAt)
    .all();

  // Fetch attachments for all messages in a single query
  const messageIds = messages.map((m) => m.id);
  const allAttachments = messageIds.length > 0
    ? db
        .select()
        .from(chatAttachments)
        .where(inArray(chatAttachments.chatMessageId, messageIds))
        .all()
    : [];

  // Group attachments by message ID
  const attachmentsByMessage = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const msgId = att.chatMessageId!;
    const existing = attachmentsByMessage.get(msgId) || [];
    existing.push(att);
    attachmentsByMessage.set(msgId, existing);
  }

  const messagesWithAttachments = messages.map((msg) => ({
    ...msg,
    attachments: (attachmentsByMessage.get(msg.id) || []).map((att) => ({
      id: att.id,
      fileName: att.fileName,
      mimeType: att.mimeType,
      url: `/api/projects/${projectId}/chat/uploads/${att.id}`,
    })),
  }));

  return NextResponse.json({ data: messagesWithAttachments });
}
