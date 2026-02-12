import { beforeEach, describe, expect, it, vi } from "vitest";

const mockProviderHelpers = vi.hoisted(() => ({
  listGlobalAgentProviders: vi.fn(),
  listMergedProjectAgentProviders: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
}));

vi.mock("@/lib/agent-config/providers", () => ({
  listGlobalAgentProviders: mockProviderHelpers.listGlobalAgentProviders,
  listMergedProjectAgentProviders: mockProviderHelpers.listMergedProjectAgentProviders,
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDb.getQueue.shift() ?? null),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        run: vi.fn(),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          run: vi.fn(),
        }),
      }),
    }),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  projects: { id: "id" },
  agentProviderDefaults: {
    id: "id",
    agentType: "agentType",
    provider: "provider",
    scope: "scope",
  },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "apd-1"),
}));

function mockRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as import("next/server").NextRequest;
}

describe("Agent provider default routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockProviderHelpers.listGlobalAgentProviders.mockResolvedValue([]);
    mockProviderHelpers.listMergedProjectAgentProviders.mockResolvedValue([]);
  });

  it("GET /api/agent-config/providers returns defaults for all agent types", async () => {
    mockProviderHelpers.listGlobalAgentProviders.mockResolvedValue([
      {
        agentType: "build",
        provider: "claude-code",
        source: "builtin",
        scope: "global",
      },
    ]);

    const { GET } = await import("@/app/api/agent-config/providers/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data[0].agentType).toBe("build");
  });

  it("PUT /api/agent-config/providers/[agentType] validates provider values", async () => {
    const { PUT } = await import(
      "@/app/api/agent-config/providers/[agentType]/route"
    );

    const res = await PUT(mockRequest({ provider: "invalid" }), {
      params: Promise.resolve({ agentType: "build" }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("provider must be");
  });

  it("PUT /api/agent-config/providers/[agentType] upserts global defaults", async () => {
    const { PUT } = await import(
      "@/app/api/agent-config/providers/[agentType]/route"
    );
    mockDb.getQueue = [
      null,
      {
        id: "apd-1",
        agentType: "build",
        provider: "codex",
        scope: "global",
      },
    ];

    const res = await PUT(mockRequest({ provider: "codex" }), {
      params: Promise.resolve({ agentType: "build" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.provider).toBe("codex");
  });

  it("GET /api/projects/[projectId]/agent-config/providers returns merged defaults", async () => {
    mockDb.getQueue = [{ id: "proj-1" }];
    mockProviderHelpers.listMergedProjectAgentProviders.mockResolvedValue([
      {
        agentType: "build",
        provider: "codex",
        source: "project",
        scope: "proj-1",
      },
      {
        agentType: "chat",
        provider: "claude-code",
        source: "builtin",
        scope: "global",
      },
    ]);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/agent-config/providers/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "proj-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data[0].source).toBe("project");
    expect(json.data[1].provider).toBe("claude-code");
  });

  it("PUT /api/projects/[projectId]/agent-config/providers/[agentType] sets project override", async () => {
    const { PUT } = await import(
      "@/app/api/projects/[projectId]/agent-config/providers/[agentType]/route"
    );
    mockDb.getQueue = [
      { id: "proj-1" },
      null,
      {
        id: "apd-1",
        agentType: "chat",
        provider: "codex",
        scope: "proj-1",
      },
    ];

    const res = await PUT(mockRequest({ provider: "codex" }), {
      params: Promise.resolve({ projectId: "proj-1", agentType: "chat" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.scope).toBe("proj-1");
    expect(json.data.provider).toBe("codex");
  });
});
