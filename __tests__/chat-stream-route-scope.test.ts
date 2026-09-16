/**
 * POST /chat/stream scoping, against the real handler and a migrated SQLite:
 * the chain mock the other chat-stream-route tests use ignores `where()`, so
 * it cannot tell a project-scoped query from an unscoped one.
 *
 * - Every chat message belongs to a conversation. Orphans used to be swept up
 *   by a pass replayed from GET /conversations; that pass is now migration
 *   0061, which runs once, so the route must stop creating new ones.
 * - A turn may only claim attachments that are this project's and still free.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  return { ...createTestDb(), ensureDbReady: vi.fn() };
});
vi.mock("@/lib/claude/spawn", () => ({ spawnClaude: vi.fn(), spawnClaudeStream: vi.fn() }));
vi.mock("@/lib/chat/cli-tool-channel", () => ({ createChatCliToolChannel: vi.fn(() => null) }));
vi.mock("@/lib/chat/title-generation", () => ({
  generateConversationTitle: vi.fn(async () => null),
}));

import { sqlite } from "@/lib/db";
import { spawnClaudeStream } from "@/lib/claude/spawn";
import { POST } from "@/app/api/projects/[projectId]/chat/stream/route";

const context = { params: Promise.resolve({ projectId: "p_1" }) };

function send(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/projects/p_1/chat/stream", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    context,
  );
}

function messageCount(): number {
  return (sqlite.prepare("SELECT count(*) AS n FROM chat_messages").get() as { n: number }).n;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(spawnClaudeStream).mockImplementation(() => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text", text: "Reply" });
        controller.close();
      },
    }),
    kill: vi.fn(),
  }));
  // `p_1` on purpose: `_` is a LIKE wildcard, so a prefix match written with
  // LIKE would also accept `data/uploads/pX1/...`.
  sqlite.exec(`
    DELETE FROM chat_attachments; DELETE FROM chat_messages; DELETE FROM chat_conversations;
    DELETE FROM projects; DELETE FROM settings; DELETE FROM agent_provider_defaults;
    INSERT INTO projects(id,name) VALUES('p_1','Project'), ('other','Other');
    INSERT INTO chat_conversations(id,project_id,type,label,provider)
      VALUES('conv','p_1','chat','Chat','claude-code'),
            ('foreign','other','chat','Chat','claude-code');
  `);
});

describe("POST /chat/stream conversation scope", () => {
  it("refuses a message without a conversation instead of storing an orphan", async () => {
    const response = await send({ content: "Hello" });

    expect(response.status).toBe(400);
    expect(messageCount()).toBe(0);
    expect(spawnClaudeStream).not.toHaveBeenCalled();
  });

  it("answers 404 for another project's conversation", async () => {
    const response = await send({ content: "Hello", conversationId: "foreign" });

    expect(response.status).toBe(404);
    expect(messageCount()).toBe(0);
    expect(spawnClaudeStream).not.toHaveBeenCalled();
  });

  it("stores the turn in the conversation it names", async () => {
    const response = await send({ content: "Hello", conversationId: "conv" });
    expect(response.status).toBe(200);
    await response.text();

    expect(
      sqlite
        .prepare("SELECT role, conversation_id AS c FROM chat_messages ORDER BY role DESC")
        .all(),
    ).toEqual([
      { role: "user", c: "conv" },
      { role: "assistant", c: "conv" },
    ]);
  });
});

describe("POST /chat/stream attachment claim", () => {
  it("links only this project's free attachments to the user message", async () => {
    sqlite.exec(`
      INSERT INTO chat_messages(id,project_id,conversation_id,role,content)
        VALUES('earlier','p_1','conv','user','earlier');
      INSERT INTO chat_attachments(id,project_id,chat_message_id,file_name,file_path,mime_type,size_bytes) VALUES
        ('own','p_1',NULL,'a.png','data/uploads/p_1/a.png','image/png',1),
        ('legacy',NULL,NULL,'b.png','data/uploads/p_1/b.png','image/png',1),
        ('lookalike',NULL,NULL,'c.png','data/uploads/pX1/c.png','image/png',1),
        ('foreign','other',NULL,'d.png','data/uploads/other/d.png','image/png',1),
        ('claimed','p_1','earlier','e.png','data/uploads/p_1/e.png','image/png',1);
    `);

    const response = await send({
      content: "Look",
      conversationId: "conv",
      attachmentIds: ["own", "legacy", "lookalike", "foreign", "claimed"],
    });
    expect(response.status).toBe(200);
    await response.text();

    const userMessage = sqlite
      .prepare("SELECT id FROM chat_messages WHERE content = 'Look'")
      .get() as { id: string };
    const rows = sqlite
      .prepare("SELECT id, chat_message_id AS m FROM chat_attachments ORDER BY id")
      .all();
    expect(rows).toEqual([
      { id: "claimed", m: "earlier" },
      { id: "foreign", m: null },
      { id: "legacy", m: userMessage.id },
      { id: "lookalike", m: null },
      { id: "own", m: userMessage.id },
    ]);
  });
});
