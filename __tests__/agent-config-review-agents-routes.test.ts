import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockHelpers = vi.hoisted(() => ({
  listGlobalCustomReviewAgents: vi.fn(),
  listMergedCustomReviewAgents: vi.fn(),
  createCustomReviewAgent: vi.fn(),
  updateCustomReviewAgent: vi.fn(),
  deleteCustomReviewAgent: vi.fn(),
}));

vi.mock("@/lib/agent-config/review-agents", () => ({
  listGlobalCustomReviewAgents: mockHelpers.listGlobalCustomReviewAgents,
  listMergedCustomReviewAgents: mockHelpers.listMergedCustomReviewAgents,
  createCustomReviewAgent: mockHelpers.createCustomReviewAgent,
  updateCustomReviewAgent: mockHelpers.updateCustomReviewAgent,
  deleteCustomReviewAgent: mockHelpers.deleteCustomReviewAgent,
}));

// Real @/lib/db/schema: side-effect-free pure builders that the chain mock
// ignores. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "cra-1"),
}));

describe("Agent config custom review agent routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
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
    const res = await POST(mockJsonRequest({ name: "" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details.name[0]).toContain("name is required");
  });

  it("POST /api/agent-config/review-agents enforces uniqueness within scope", async () => {
    const { POST } = await import("@/app/api/agent-config/review-agents/route");
    mockHelpers.createCustomReviewAgent.mockResolvedValue(null);

    const res = await POST(
      mockJsonRequest({ name: "UI Review", systemPrompt: "Review UI consistency" })
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
      mockJsonRequest({
        name: "UI Review",
        systemPrompt: "Updated prompt",
        isEnabled: false,
      }),
      mockRouteContext({ agentId: "a1" })
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

    const res = await DELETE(mockNextRequest(), mockRouteContext({ agentId: "a1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.ok).toBe(true);
  });

  it("GET /api/projects/[projectId]/agent-config/review-agents returns global + project agents", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];
    mockHelpers.listMergedCustomReviewAgents.mockResolvedValue([
      { id: "g1", name: "Global Agent", scope: "global", source: "global" },
      { id: "p1", name: "Project Agent", scope: "proj-1", source: "project" },
    ]);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/agent-config/review-agents/route"
    );

    const res = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[1].source).toBe("project");
  });

  it("POST /api/projects/[projectId]/agent-config/review-agents creates project-scoped agent", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];
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
      mockJsonRequest({
        name: "Project Agent",
        systemPrompt: "Project review prompt",
      }),
      mockRouteContext({ projectId: "proj-1" })
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.scope).toBe("proj-1");
  });
});
