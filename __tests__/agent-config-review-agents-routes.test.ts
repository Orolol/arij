import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHelpers = vi.hoisted(() => ({
  listGlobalCustomReviewAgents: vi.fn(),
  listMergedCustomReviewAgents: vi.fn(),
  createCustomReviewAgent: vi.fn(),
  updateCustomReviewAgent: vi.fn(),
  deleteCustomReviewAgent: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
}));

vi.mock("@/lib/agent-config/review-agents", () => ({
  listGlobalCustomReviewAgents: mockHelpers.listGlobalCustomReviewAgents,
  listMergedCustomReviewAgents: mockHelpers.listMergedCustomReviewAgents,
  createCustomReviewAgent: mockHelpers.createCustomReviewAgent,
  updateCustomReviewAgent: mockHelpers.updateCustomReviewAgent,
  deleteCustomReviewAgent: mockHelpers.deleteCustomReviewAgent,
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDb.getQueue.shift() ?? null),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  projects: { id: "id" },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "cra-1"),
}));

function mockRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as import("next/server").NextRequest;
}

describe("Agent config custom review agent routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockHelpers.listGlobalCustomReviewAgents.mockResolvedValue([]);
    mockHelpers.listMergedCustomReviewAgents.mockResolvedValue([]);
    mockHelpers.createCustomReviewAgent.mockResolvedValue(null);
    mockHelpers.updateCustomReviewAgent.mockResolvedValue({ data: null });
    mockHelpers.deleteCustomReviewAgent.mockResolvedValue(false);
  });

  it("GET /api/agent-config/review-agents returns global custom agents", async () => {
    mockHelpers.listGlobalCustomReviewAgents.mockResolvedValue([
      { id: "a1", name: "UI Review", systemPrompt: "Review UI", scope: "global" },
    ]);

    const { GET } = await import("@/app/api/agent-config/review-agents/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
  });

  it("POST /api/agent-config/review-agents validates required fields", async () => {
    const { POST } = await import("@/app/api/agent-config/review-agents/route");
    const res = await POST(mockRequest({ name: "" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("name is required");
  });

  it("POST /api/agent-config/review-agents enforces uniqueness within scope", async () => {
    const { POST } = await import("@/app/api/agent-config/review-agents/route");
    mockHelpers.createCustomReviewAgent.mockResolvedValue(null);

    const res = await POST(
      mockRequest({ name: "UI Review", systemPrompt: "Review UI consistency" })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("already exists");
  });

  it("PATCH /api/agent-config/review-agents/[agentId] updates name/prompt/isEnabled", async () => {
    const { PATCH } = await import(
      "@/app/api/agent-config/review-agents/[agentId]/route"
    );
    mockHelpers.updateCustomReviewAgent.mockResolvedValue({
      data: {
        id: "a1",
        name: "UI Review",
        systemPrompt: "Updated prompt",
        scope: "global",
        position: 0,
        isEnabled: 0,
      },
    });

    const res = await PATCH(
      mockRequest({
        name: "UI Review",
        systemPrompt: "Updated prompt",
        isEnabled: false,
      }),
      { params: Promise.resolve({ agentId: "a1" }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.isEnabled).toBe(0);
  });

  it("DELETE /api/agent-config/review-agents/[agentId] deletes agent", async () => {
    const { DELETE } = await import(
      "@/app/api/agent-config/review-agents/[agentId]/route"
    );
    mockHelpers.deleteCustomReviewAgent.mockResolvedValue(true);

    const res = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: "a1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(true);
  });

  it("GET /api/projects/[projectId]/agent-config/review-agents returns global + project agents", async () => {
    mockDb.getQueue = [{ id: "proj-1" }];
    mockHelpers.listMergedCustomReviewAgents.mockResolvedValue([
      { id: "g1", name: "Global Agent", scope: "global", source: "global" },
      { id: "p1", name: "Project Agent", scope: "proj-1", source: "project" },
    ]);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/agent-config/review-agents/route"
    );

    const res = await GET(mockRequest({}), {
      params: Promise.resolve({ projectId: "proj-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[1].source).toBe("project");
  });

  it("POST /api/projects/[projectId]/agent-config/review-agents creates project-scoped agent", async () => {
    mockDb.getQueue = [{ id: "proj-1" }];
    mockHelpers.createCustomReviewAgent.mockResolvedValue({
      id: "p1",
      name: "Project Agent",
      systemPrompt: "Project review prompt",
      scope: "proj-1",
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/agent-config/review-agents/route"
    );
    const res = await POST(
      mockRequest({
        name: "Project Agent",
        systemPrompt: "Project review prompt",
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) }
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.scope).toBe("proj-1");
  });
});
