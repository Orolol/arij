/**
 * Server-side DEDUPLICATION of a chat-drafted epic, and nothing else.
 *
 * It does not parse conversations: the parse is entirely client-side, in
 * `lib/epic-parsing.ts`, through the two paths that already existed
 * (`hooks/useEpicCreate.ts` via `useChatWorkspace`, and
 * `components/chat-page/DraftedEpicCard.tsx` via `message-epics.ts`). This
 * module sits UNDER `POST /api/projects/:id/epics` to hash the proposal and
 * return the epic a previous identical send already created, so Backlog and
 * "Send to dev" from two tabs address one row.
 *
 * Worth stating because the table's name (`chat_epic_proposals`) reads like a
 * replacement for the client parser; it is not, and a future pass should not
 * go looking for a third parsing path that does not exist.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { ArijDatabase } from "@/lib/db";
import { chatConversations, chatEpicProposals, epics } from "@/lib/db/schema";
import type { createEpicSchema } from "@/lib/validation/schemas";

export class ChatEpicProposalError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

export interface ChatEpicProposalIdentity {
  projectId: string;
  conversationId: string;
  proposalHash: string;
}

/**
 * Hash the proposal content, with the same defaults and prose normalization.
 * Placement/dispatch options are actions on that proposal: Backlog and Send to
 * dev from two tabs must still address the same epic. The first write wins.
 */
export function identifyChatEpicProposal(projectId: string, body: z.infer<typeof createEpicSchema>): ChatEpicProposalIdentity | null {
  if (!body.sourceConversationId) return null;
  const payload = {
    title: body.title,
    description: body.description || null,
    type: body.frictionId ? "feature" : body.type || "feature",
    frictionId: body.frictionId ?? null,
    userStories: (body.userStories ?? []).map((story) => ({
      title: story.title,
      description: story.description?.trim() || null,
      acceptanceCriteria: story.acceptanceCriteria?.trim() || null,
    })),
    // Edge order and repeated copies do not change the resulting dependency set.
    dependencies: [...new Set((body.dependencies ?? []).map((edge) =>
      JSON.stringify([edge.ticketId, edge.dependsOnTicketId])))].sort(),
  };
  return { projectId, conversationId: body.sourceConversationId,
    proposalHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

/** Call again inside the creation transaction; the preflight is only a shortcut. */
export function findChatEpicProposal(database: Pick<ArijDatabase, "select">, identity: ChatEpicProposalIdentity) {
  const { projectId, conversationId, proposalHash } = identity;
  const conversation = database.select({ id: chatConversations.id }).from(chatConversations)
    .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.projectId, projectId))).get();
  if (!conversation) throw new ChatEpicProposalError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");

  const proposal = database.select().from(chatEpicProposals).where(and(
    eq(chatEpicProposals.projectId, projectId), eq(chatEpicProposals.conversationId, conversationId),
    eq(chatEpicProposals.proposalHash, proposalHash),
  )).get();
  if (!proposal) return null;
  const epic = proposal.epicId ? database.select().from(epics)
    .where(and(eq(epics.id, proposal.epicId), eq(epics.projectId, projectId))).get() : null;
  if (!epic) throw new ChatEpicProposalError("The epic created from this proposal was deleted", 409, "CHAT_EPIC_DELETED");
  return { ...epic, userStoriesCreated: proposal.userStoriesCreated, dependenciesCreated: proposal.dependenciesCreated };
}
