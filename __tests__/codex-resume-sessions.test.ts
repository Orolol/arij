import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
} from "@/__tests__/helpers/db-mock";

const mockResolveAgent = vi.hoisted(() => vi.fn());
const mockResolveAgentByNamedId = vi.hoisted(() => vi.fn());

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgent: mockResolveAgent,
  resolveAgentByNamedId: mockResolveAgentByNamedId,
}));

describe("GET /api/projects/[projectId]/sessions/resumable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockResolveAgent.mockReturnValue({ provider: "codex", namedAgentId: null });
    mockResolveAgentByNamedId.mockReturnValue({ provider: "codex", namedAgentId: null });
  });

  it("returns resumable sessions for codex provider", async () => {
    dbMockState.allQueue = [
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
      mockNextRequest({ url: "http://localhost/api/projects/proj1/sessions/resumable?agentType=build&provider=codex" }),
      { params: Promise.resolve({ projectId: "proj1" }) },
    );

    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].cliSessionId).toBe("codex-cli-123");
  });

  it("returns resumable sessions for claude-code provider", async () => {
    mockResolveAgent.mockReturnValue({ provider: "claude-code", namedAgentId: null });

    dbMockState.allQueue = [
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
      mockNextRequest({ url: "http://localhost/api/projects/proj1/sessions/resumable?agentType=build&provider=claude-code" }),
      { params: Promise.resolve({ projectId: "proj1" }) },
    );

    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].cliSessionId).toBe("claude-cli-456");
  });
});
