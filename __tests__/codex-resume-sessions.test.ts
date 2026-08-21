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

  /**
   * This used to assert the opposite. `fix(codex): enable session resume`
   * (b3d25eb) made the endpoint list codex sessions, but codex never reports
   * the thread id it created — `CodexProvider.parseSessionId()` returns
   * undefined — so the stored id is one Arij invented and `codex exec resume`
   * would reject it. validateResumeSession has refused codex ever since, so
   * every entry this endpoint returned was a picker option that silently
   * started a fresh run. The endpoint now agrees with dispatch.
   */
  it("returns no resumable sessions for codex, which cannot resume", async () => {
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
    expect(json.data).toEqual([]);
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
