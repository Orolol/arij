import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPromptHelpers = vi.hoisted(() => ({
  listGlobalAgentPrompts: vi.fn(),
  listMergedProjectAgentPrompts: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  listGlobalAgentPrompts: mockPromptHelpers.listGlobalAgentPrompts,
  listMergedProjectAgentPrompts: mockPromptHelpers.listMergedProjectAgentPrompts,
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDb.getQueue.shift() ?? null),
    all: vi.fn(() => mockDb.allQueue.shift() ?? []),
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
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        run: vi.fn(() => ({ changes: 1 })),
      }),
    }),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  agentPrompts: {
    id: "id",
    agentType: "agentType",
    systemPrompt: "systemPrompt",
    scope: "scope",
  },
  projects: {
    id: "id",
  },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "new-id"),
}));

function mockRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as import("next/server").NextRequest;
}

describe("Agent config prompts routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.allQueue = [];
    mockPromptHelpers.listGlobalAgentPrompts.mockResolvedValue([]);
    mockPromptHelpers.listMergedProjectAgentPrompts.mockResolvedValue([]);
  });

  it("GET /api/agent-config/prompts returns { data }", async () => {
    mockPromptHelpers.listGlobalAgentPrompts.mockResolvedValue([
      {
        agentType: "build",
        systemPrompt: "",
        source: "builtin",
        scope: "global",
      },
    ]);

    const { GET } = await import("@/app/api/agent-config/prompts/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(mockPromptHelpers.listGlobalAgentPrompts).toHaveBeenCalledTimes(1);
  });

  it("PUT /api/agent-config/prompts/[agentType] validates known agent types", async () => {
    const { PUT } = await import(
      "@/app/api/agent-config/prompts/[agentType]/route"
    );

    const res = await PUT(mockRequest({ systemPrompt: "Prompt" }), {
      params: Promise.resolve({ agentType: "unknown" }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Unknown agent type");
  });

  it("PUT /api/agent-config/prompts/[agentType] upserts global prompt", async () => {
    const { PUT } = await import(
      "@/app/api/agent-config/prompts/[agentType]/route"
    );
    mockDb.getQueue = [
      null,
      {
        id: "new-id",
        agentType: "build",
        systemPrompt: "Use TDD",
        scope: "global",
      },
    ];

    const res = await PUT(mockRequest({ systemPrompt: "Use TDD" }), {
      params: Promise.resolve({ agentType: "build" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.agentType).toBe("build");
    expect(json.data.systemPrompt).toBe("Use TDD");
  });

  it("GET /api/projects/[projectId]/agent-config/prompts returns merged prompts", async () => {
    mockPromptHelpers.listMergedProjectAgentPrompts.mockResolvedValue([
      {
        agentType: "build",
        systemPrompt: "Project build prompt",
        source: "project",
        scope: "proj-1",
      },
    ]);
    mockDb.getQueue = [{ id: "proj-1" }];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/agent-config/prompts/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "proj-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data[0].source).toBe("project");
    expect(mockPromptHelpers.listMergedProjectAgentPrompts).toHaveBeenCalledWith(
      "proj-1"
    );
  });

  it("PUT /api/projects/[projectId]/agent-config/prompts/[agentType] upserts project override", async () => {
    const { PUT } = await import(
      "@/app/api/projects/[projectId]/agent-config/prompts/[agentType]/route"
    );

    mockDb.getQueue = [
      { id: "proj-1" },
      null,
      {
        id: "new-id",
        agentType: "build",
        systemPrompt: "Project override",
        scope: "proj-1",
      },
    ];

    const res = await PUT(mockRequest({ systemPrompt: "Project override" }), {
      params: Promise.resolve({ projectId: "proj-1", agentType: "build" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.scope).toBe("proj-1");
    expect(json.data.systemPrompt).toBe("Project override");
  });

  it("DELETE /api/projects/[projectId]/agent-config/prompts/[agentType] removes project override", async () => {
    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/agent-config/prompts/[agentType]/route"
    );

    mockDb.getQueue = [{ id: "proj-1" }];

    const res = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "proj-1", agentType: "build" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(true);
  });
});
