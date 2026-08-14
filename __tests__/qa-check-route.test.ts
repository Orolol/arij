import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockCreateId = vi.hoisted(() => vi.fn());

const mockLifecycle = vi.hoisted(() => ({
  createQueuedSession: vi.fn(),
  markSessionRunning: vi.fn(),
  markSessionTerminal: vi.fn(),
  isSessionLifecycleConflictError: vi.fn(() => false),
}));

const mockProcessManager = vi.hoisted(() => ({
  start: vi.fn(),
  getStatus: vi.fn(),
}));

const mockResolvers = vi.hoisted(() => ({
  resolveAgentPrompt: vi.fn(),
  resolveAgentByNamedId: vi.fn(),
}));

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: mockCreateId,
}));

vi.mock("@/lib/claude/prompt-builder", () => ({
  buildTechCheckPrompt: vi.fn(() => "TECH_CHECK_PROMPT"),
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: mockResolvers.resolveAgentPrompt,
}));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: mockResolvers.resolveAgentByNamedId,
}));

// listProjectTextDocuments is no longer used by the QA check route —
// QA prompts intentionally exclude project documents.

vi.mock("@/lib/agent-sessions/lifecycle", () => ({
  createQueuedSession: mockLifecycle.createQueuedSession,
  markSessionRunning: mockLifecycle.markSessionRunning,
  markSessionTerminal: mockLifecycle.markSessionTerminal,
  isSessionLifecycleConflictError: mockLifecycle.isSessionLifecycleConflictError,
}));

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: mockProcessManager,
}));

vi.mock("@/lib/claude/json-parser", () => ({
  parseClaudeOutput: vi.fn(() => ({ content: "Parsed content" })),
}));

vi.mock("fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("path", () => ({
  default: {
    join: vi.fn((...parts: string[]) => parts.join("/")),
  },
}));

describe("POST /api/projects/[projectId]/qa/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockCreateId
      .mockReset()
      .mockReturnValueOnce("session-1")
      .mockReturnValueOnce("report-1");
    mockResolvers.resolveAgentPrompt.mockResolvedValue("System prompt");
    mockResolvers.resolveAgentByNamedId.mockReturnValue({
      provider: "claude-code",
      model: "claude-opus-4-1",
    });
    mockProcessManager.start.mockReturnValue({
      sessionId: "session-1",
      status: "running",
      startedAt: new Date(),
    });
    mockProcessManager.getStatus.mockReturnValue(null);
  });

  it("returns 404 when project does not exist", async () => {
    dbMockState.getQueue = [null];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/check/route"
    );
    const res = await POST(mockJsonRequest({}), mockRouteContext({ projectId: "missing" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("Project not found");
  });

  it("returns 400 when project has no git repo path", async () => {
    dbMockState.getQueue = [
      { id: "proj-1", name: "Arij", gitRepoPath: null, spec: "Spec" },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/check/route"
    );
    const res = await POST(mockJsonRequest({}), mockRouteContext({ projectId: "proj-1" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("git repository");
  });

  it("creates a running QA report and launches a tech_check session", async () => {
    dbMockState.getQueue = [
      { id: "proj-1", name: "Arij", gitRepoPath: "/tmp/repo", spec: "Spec" },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/check/route"
    );
    const res = await POST(
      mockJsonRequest({ customPrompt: "Focus on architecture" }),
      mockRouteContext({ projectId: "proj-1" }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.reportId).toBe("report-1");
    expect(json.data.sessionId).toBe("session-1");
    expect(mockLifecycle.createQueuedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "session-1",
        projectId: "proj-1",
        agentType: "tech_check",
      }),
    );
    expect(mockProcessManager.start).toHaveBeenCalledTimes(1);
  });
});
