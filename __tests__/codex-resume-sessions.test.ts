import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbState = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
}));

const mockResolveAgent = vi.hoisted(() => vi.fn());
const mockResolveAgentByNamedId = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn((v: unknown) => v),
  isNotNull: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDbState.getQueue.shift() ?? null),
    all: vi.fn(() => mockDbState.allQueue.shift() ?? []),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  agentSessions: {
    id: "id",
    projectId: "projectId",
    epicId: "epicId",
    userStoryId: "userStoryId",
    status: "status",
    provider: "provider",
    namedAgentId: "namedAgentId",
    agentType: "agentType",
    cliSessionId: "cliSessionId",
    claudeSessionId: "claudeSessionId",
    lastNonEmptyText: "lastNonEmptyText",
    completedAt: "completedAt",
  },
  namedAgents: { id: "id", provider: "provider" },
}));

vi.mock("@/lib/agent-config/providers", () => ({
  resolveAgent: mockResolveAgent,
  resolveAgentByNamedId: mockResolveAgentByNamedId,
}));

function mockRequest(url: string) {
  return new Request(url) as unknown as import("next/server").NextRequest;
}

describe("GET /api/projects/[projectId]/sessions/resumable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.getQueue = [];
    mockDbState.allQueue = [];
    mockResolveAgent.mockReturnValue({ provider: "codex", namedAgentId: null });
    mockResolveAgentByNamedId.mockReturnValue({ provider: "codex", namedAgentId: null });
  });

  it("returns resumable sessions for codex provider", async () => {
    mockDbState.allQueue = [
      [
        {
          id: "session-1",
          cliSessionId: "codex-cli-123",
          claudeSessionId: null,
          provider: "codex",
          namedAgentId: null,
          agentType: "build",
          lastNonEmptyText: "Done",
          completedAt: "2026-02-16T10:00:00Z",
        },
      ],
    ];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/sessions/resumable/route"
    );

    const res = await GET(
      mockRequest("http://localhost/api/projects/proj1/sessions/resumable?agentType=build&provider=codex"),
      { params: Promise.resolve({ projectId: "proj1" }) },
    );

    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].cliSessionId).toBe("codex-cli-123");
  });

  it("returns resumable sessions for claude-code provider", async () => {
    mockResolveAgent.mockReturnValue({ provider: "claude-code", namedAgentId: null });

    mockDbState.allQueue = [
      [
        {
          id: "session-2",
          cliSessionId: "claude-cli-456",
          claudeSessionId: null,
          provider: "claude-code",
          namedAgentId: null,
          agentType: "build",
          lastNonEmptyText: "Completed",
          completedAt: "2026-02-16T11:00:00Z",
        },
      ],
    ];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/sessions/resumable/route"
    );

    const res = await GET(
      mockRequest("http://localhost/api/projects/proj1/sessions/resumable?agentType=build&provider=claude-code"),
      { params: Promise.resolve({ projectId: "proj1" }) },
    );

    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].cliSessionId).toBe("claude-cli-456");
  });
});
