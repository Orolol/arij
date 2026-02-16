import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbChain } = vi.hoisted(() => ({
  dbChain: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    leftJoin: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    run: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: dbChain,
}));

vi.mock("@/lib/db/schema", () => ({
  chatConversations: {
    id: "id",
    projectId: "projectId",
    type: "type",
    label: "label",
    status: "status",
    epicId: "epicId",
    provider: "provider",
    namedAgentId: "namedAgentId",
    createdAt: "createdAt",
  },
  namedAgents: { id: "id", readableAgentName: "readableAgentName" },
}));

vi.mock("@/lib/agent-config/providers", () => ({
  resolveAgent: vi.fn(() => ({ provider: "claude-code" })),
}));

function setupChainReturn(data: unknown) {
  dbChain.select.mockReturnValue(dbChain);
  dbChain.from.mockReturnValue(dbChain);
  dbChain.leftJoin.mockReturnValue(dbChain);
  dbChain.where.mockReturnValue(dbChain);
  dbChain.get.mockReturnValue(data);
}

describe("conversation GET route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns conversation with namedAgentName", async () => {
    setupChainReturn({
      id: "conv-1",
      projectId: "proj-1",
      type: "brainstorm",
      label: "My Chat",
      status: "active",
      epicId: null,
      provider: "claude-code",
      namedAgentId: "agent-1",
      createdAt: "2026-02-12T00:00:00.000Z",
      namedAgentName: "Athena",
    });

    const { GET } = await import(
      "@/app/api/projects/[projectId]/conversations/[conversationId]/route"
    );
    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1", conversationId: "conv-1" }),
    });

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.id).toBe("conv-1");
    expect(json.data.namedAgentName).toBe("Athena");
    expect(json.data.label).toBe("My Chat");
  });

  it("returns 404 when conversation not found", async () => {
    setupChainReturn(undefined);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/conversations/[conversationId]/route"
    );
    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1", conversationId: "nonexistent" }),
    });

    const json = await response.json();
    expect(response.status).toBe(404);
    expect(json.error).toBe("Conversation not found");
  });

  it("returns 404 when conversation belongs to different project", async () => {
    // The WHERE clause filters by both projectId and conversationId,
    // so a mismatch returns undefined
    setupChainReturn(undefined);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/conversations/[conversationId]/route"
    );
    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "wrong-proj", conversationId: "conv-1" }),
    });

    const json = await response.json();
    expect(response.status).toBe(404);
    expect(json.error).toBe("Conversation not found");
  });
});
