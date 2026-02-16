import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- db mock: two independent chains (sessions + conversations) ----
const { sessionsChain, conversationsChain } = vi.hoisted(() => {
  const makeChain = () => ({
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    leftJoin: vi.fn(),
    all: vi.fn(),
  });
  return { sessionsChain: makeChain(), conversationsChain: makeChain() };
});

// The db.select() is called twice: first for agent sessions, then for conversations.
// We use callCount to route to the correct chain.
let selectCallCount = 0;
const dbProxy = {
  select: vi.fn(() => {
    selectCallCount++;
    return selectCallCount === 1 ? sessionsChain : conversationsChain;
  }),
};

vi.mock("@/lib/db", () => ({
  db: dbProxy,
}));

vi.mock("@/lib/db/schema", () => ({
  agentSessions: { projectId: "projectId", createdAt: "createdAt" },
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
  chatMessages: { conversationId: "conversationId" },
  namedAgents: { id: "id", readableAgentName: "readableAgentName" },
}));

vi.mock("@/lib/agent-sessions/backfill", () => ({
  runBackfillRecentSessionLastNonEmptyTextOnce: vi.fn(),
}));

function setupSessionsChain(data: unknown[]) {
  sessionsChain.select.mockReturnValue(sessionsChain);
  sessionsChain.from.mockReturnValue(sessionsChain);
  sessionsChain.where.mockReturnValue(sessionsChain);
  sessionsChain.orderBy.mockReturnValue(sessionsChain);
  sessionsChain.all.mockReturnValue(data);
}

function setupConversationsChain(data: unknown[]) {
  conversationsChain.select.mockReturnValue(conversationsChain);
  conversationsChain.from.mockReturnValue(conversationsChain);
  conversationsChain.where.mockReturnValue(conversationsChain);
  conversationsChain.leftJoin.mockReturnValue(conversationsChain);
  conversationsChain.all.mockReturnValue(data);
}

describe("sessions list route (unified)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
  });

  it("returns agent sessions with kind='agent_session'", async () => {
    setupSessionsChain([
      {
        id: "sess-1",
        status: "running",
        lastNonEmptyText: "Applying migrations",
        createdAt: "2026-02-12T00:00:00.000Z",
      },
    ]);
    setupConversationsChain([]);

    const { GET } = await import("@/app/api/projects/[projectId]/sessions/route");
    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1" }),
    });

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].kind).toBe("agent_session");
    expect(json.data[0].lastNonEmptyText).toBe("Applying migrations");
  });

  it("returns chat conversations with kind='chat_session'", async () => {
    setupSessionsChain([]);
    setupConversationsChain([
      {
        id: "conv-1",
        type: "brainstorm",
        label: "My Chat",
        status: "active",
        provider: "claude-code",
        namedAgentName: null,
        messageCount: 5,
        lastMessagePreview: "Hello world",
        createdAt: "2026-02-12T01:00:00.000Z",
      },
    ]);

    const { GET } = await import("@/app/api/projects/[projectId]/sessions/route");
    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1" }),
    });

    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].kind).toBe("chat_session");
    expect(json.data[0].label).toBe("My Chat");
    expect(json.data[0].messageCount).toBe(5);
    expect(json.data[0].lastMessagePreview).toBe("Hello world");
  });

  it("merges and sorts both types by createdAt descending", async () => {
    setupSessionsChain([
      {
        id: "sess-1",
        status: "completed",
        createdAt: "2026-02-12T00:00:00.000Z",
      },
      {
        id: "sess-2",
        status: "running",
        createdAt: "2026-02-12T03:00:00.000Z",
      },
    ]);
    setupConversationsChain([
      {
        id: "conv-1",
        type: "epic",
        label: "Epic Chat",
        status: "generated",
        createdAt: "2026-02-12T01:00:00.000Z",
        messageCount: 3,
        lastMessagePreview: null,
      },
    ]);

    const { GET } = await import("@/app/api/projects/[projectId]/sessions/route");
    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1" }),
    });

    const json = await response.json();
    expect(json.data).toHaveLength(3);
    // Sorted desc: sess-2 (03:00), conv-1 (01:00), sess-1 (00:00)
    expect(json.data[0].id).toBe("sess-2");
    expect(json.data[0].kind).toBe("agent_session");
    expect(json.data[1].id).toBe("conv-1");
    expect(json.data[1].kind).toBe("chat_session");
    expect(json.data[2].id).toBe("sess-1");
    expect(json.data[2].kind).toBe("agent_session");
  });

  it("preserves existing agent session shape (backward compatible)", async () => {
    setupSessionsChain([
      {
        id: "sess-1",
        status: "completed",
        mode: "code",
        provider: "claude-code",
        agentType: "build",
        branchName: "feat/test",
        model: "opus-4",
        error: null,
        createdAt: "2026-02-12T00:00:00.000Z",
      },
    ]);
    setupConversationsChain([]);

    const { GET } = await import("@/app/api/projects/[projectId]/sessions/route");
    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1" }),
    });

    const json = await response.json();
    const session = json.data[0];
    expect(session.mode).toBe("code");
    expect(session.provider).toBe("claude-code");
    expect(session.agentType).toBe("build");
    expect(session.branchName).toBe("feat/test");
    expect(session.model).toBe("opus-4");
  });
});
