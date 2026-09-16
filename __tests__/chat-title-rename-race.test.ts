/**
 * The automatic title of a conversation must never overwrite a name the user
 * gave it.
 *
 * The turn runner decides to title a conversation when it still carries a
 * default label after its first exchange, then asks an agent for a title —
 * which takes seconds. A user who renames the conversation in that window
 * used to lose the rename: the title landed with an unconditional UPDATE.
 * The write is now conditional on the label the decision was made on.
 *
 * Real SQLite (the shared chain mock ignores WHERE clauses, so it cannot tell
 * a conditional update from an unconditional one).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const titles = vi.hoisted(() => ({
  resolve: null as null | ((title: string | null) => void),
}));

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const { db, sqlite } = createTestDb();
  return { db, sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/chat/title-generation", () => ({
  generateConversationTitle: vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        titles.resolve = resolve;
      }),
  ),
}));

import { db } from "@/lib/db";
import { chatConversations, chatMessages, projects } from "@/lib/db/schema";
import { runChatTurn, type ChatTurnStrategy } from "@/lib/chat/turn-runner";

let counter = 0;

function seed(label: string) {
  counter += 1;
  const projectId = `proj-title-${counter}`;
  const conversationId = `conv-title-${counter}`;
  db.insert(projects).values({ id: projectId, name: projectId }).run();
  db.insert(chatConversations)
    .values({ id: conversationId, projectId, type: "chat", label })
    .run();
  // The user's message of the first exchange; the runner stores the reply.
  db.insert(chatMessages)
    .values({
      id: `msg-user-${counter}`,
      projectId,
      conversationId,
      role: "user",
      content: "Hello",
      createdAt: new Date().toISOString(),
    })
    .run();
  return { projectId, conversationId };
}

const answering: ChatTurnStrategy = {
  provider: "claude-code",
  onKill: "fail",
  persistAfterClientCancel: false,
  run: async (io) => {
    io.emit({ type: "text", text: "Answer" });
    return { status: "active" };
  },
  kill: () => {},
  release: () => {},
  describeFailure: () => "Error: failed",
};

function labelOf(conversationId: string): string | undefined {
  return db
    .select({ label: chatConversations.label })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .get()?.label;
}

async function firstExchange(projectId: string, conversationId: string) {
  titles.resolve = null;
  const response = runChatTurn({
    projectId,
    conversationId,
    userContent: "Hello",
    activityLabel: "Chat: Chat",
    namedAgentName: null,
    strategy: answering,
  });
  await response.text();
  await vi.waitFor(() => expect(titles.resolve).not.toBeNull());
}

describe("automatic conversation title vs a manual rename", () => {
  beforeEach(() => {
    titles.resolve = null;
  });

  it("titles a conversation that still carries its default label", async () => {
    const { projectId, conversationId } = seed("Chat");
    await firstExchange(projectId, conversationId);

    titles.resolve!("Importer plan");
    await vi.waitFor(() => expect(labelOf(conversationId)).toBe("Importer plan"));
  });

  it("keeps a name the user gave while the title was being generated", async () => {
    const { projectId, conversationId } = seed("Chat");
    await firstExchange(projectId, conversationId);

    // The user renames the conversation while the title agent is running.
    db.update(chatConversations)
      .set({ label: "Release checklist" })
      .where(eq(chatConversations.id, conversationId))
      .run();

    titles.resolve!("Importer plan");
    // Give the title's write every chance to land before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(labelOf(conversationId)).toBe("Release checklist");
  });
});
