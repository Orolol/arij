import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  agentSessions,
  chatConversations,
  chatMessages,
  namedAgents,
} from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { getSessionStatusForApi } from "@/lib/agent-sessions/lifecycle";
import { runBackfillRecentSessionLastNonEmptyTextOnce } from "@/lib/agent-sessions/backfill";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  runBackfillRecentSessionLastNonEmptyTextOnce(projectId);

  // Fetch agent sessions
  const sessions = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.projectId, projectId))
    .all();

  const normalizedSessions = sessions.map((session) => ({
    ...session,
    kind: "agent_session" as const,
    status: getSessionStatusForApi(session.status),
  }));

  // Fetch chat conversations with message count, last message preview, and named agent name
  const conversations = db
    .select({
      id: chatConversations.id,
      projectId: chatConversations.projectId,
      type: chatConversations.type,
      label: chatConversations.label,
      status: chatConversations.status,
      epicId: chatConversations.epicId,
      provider: chatConversations.provider,
      namedAgentId: chatConversations.namedAgentId,
      createdAt: chatConversations.createdAt,
      namedAgentName: namedAgents.readableAgentName,
      messageCount: sql<number>`(
        SELECT COUNT(*) FROM chat_messages
        WHERE chat_messages.conversation_id = ${chatConversations.id}
      )`.as("message_count"),
      lastMessagePreview: sql<string | null>`(
        SELECT SUBSTR(content, 1, 120) FROM chat_messages
        WHERE chat_messages.conversation_id = ${chatConversations.id}
        ORDER BY created_at DESC LIMIT 1
      )`.as("last_message_preview"),
    })
    .from(chatConversations)
    .leftJoin(namedAgents, eq(chatConversations.namedAgentId, namedAgents.id))
    .where(eq(chatConversations.projectId, projectId))
    .all();

  const normalizedConversations = conversations.map((conv) => ({
    ...conv,
    kind: "chat_session" as const,
  }));

  // Merge and sort by createdAt desc, with id as tiebreaker
  const unified = [
    ...normalizedSessions,
    ...normalizedConversations,
  ].sort((a, b) => {
    const dateA = a.createdAt ?? "";
    const dateB = b.createdAt ?? "";
    if (dateB > dateA) return 1;
    if (dateB < dateA) return -1;
    return a.id.localeCompare(b.id);
  });

  return NextResponse.json({ data: unified });
}
