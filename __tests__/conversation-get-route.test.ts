import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

// Real @/lib/db/schema: side-effect-free pure builders that the chain mock
// ignores. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgent: vi.fn(() => ({ provider: "claude-code" })),
}));

function setupChainReturn(data: unknown) {
  dbMockState.getQueue = data === undefined ? [] : [data];
}

describe("conversation GET route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
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
    const response = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1", conversationId: "conv-1" }));

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
    const response = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1", conversationId: "nonexistent" }));

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
    const response = await GET(mockNextRequest(), mockRouteContext({ projectId: "wrong-proj", conversationId: "conv-1" }));

    const json = await response.json();
    expect(response.status).toBe(404);
    expect(json.error).toBe("Conversation not found");
  });
});
