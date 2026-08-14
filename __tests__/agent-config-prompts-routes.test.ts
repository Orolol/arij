import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockPromptHelpers = vi.hoisted(() => ({
  listGlobalAgentPrompts: vi.fn(),
  listMergedProjectAgentPrompts: vi.fn(),
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  listGlobalAgentPrompts: mockPromptHelpers.listGlobalAgentPrompts,
  listMergedProjectAgentPrompts: mockPromptHelpers.listMergedProjectAgentPrompts,
}));

// Real @/lib/db/schema: side-effect-free pure builders that the chain mock
// ignores. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "new-id"),
}));

describe("Agent config prompts routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
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

    const res = await PUT(mockJsonRequest({ systemPrompt: "Prompt" }), mockRouteContext({ agentType: "unknown" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Unknown agent type");
  });

  it("PUT /api/agent-config/prompts/[agentType] upserts global prompt", async () => {
    const { PUT } = await import(
      "@/app/api/agent-config/prompts/[agentType]/route"
    );
    dbMockState.getQueue = [
      null,
      {
        id: "new-id",
        agentType: "build",
        systemPrompt: "Use TDD",
        scope: "global",
      },
    ];

    const res = await PUT(mockJsonRequest({ systemPrompt: "Use TDD" }), mockRouteContext({ agentType: "build" }));
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
    dbMockState.getQueue = [{ id: "proj-1" }];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/agent-config/prompts/route"
    );
    const res = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1" }));
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

    dbMockState.getQueue = [
      { id: "proj-1" },
      null,
      {
        id: "new-id",
        agentType: "build",
        systemPrompt: "Project override",
        scope: "proj-1",
      },
    ];

    const res = await PUT(mockJsonRequest({ systemPrompt: "Project override" }), mockRouteContext({ projectId: "proj-1", agentType: "build" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.scope).toBe("proj-1");
    expect(json.data.systemPrompt).toBe("Project override");
  });

  it("DELETE /api/projects/[projectId]/agent-config/prompts/[agentType] removes project override", async () => {
    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/agent-config/prompts/[agentType]/route"
    );

    dbMockState.getQueue = [{ id: "proj-1" }];

    const res = await DELETE(mockNextRequest(), mockRouteContext({ projectId: "proj-1", agentType: "build" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(true);
  });
});
