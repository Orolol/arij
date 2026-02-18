import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  insertedValues: [] as unknown[],
  updatedValues: [] as unknown[],
}));

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

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDb.getQueue.shift() ?? null),
    insert: vi.fn().mockReturnValue({
      values: vi.fn((payload: unknown) => {
        mockDb.insertedValues.push(payload);
        return { run: vi.fn() };
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn((payload: unknown) => {
        mockDb.updatedValues.push(payload);
        return {
          where: vi.fn(() => ({ run: vi.fn() })),
        };
      }),
    }),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  projects: {
    id: "id",
  },
  qaReports: {
    id: "id",
  },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: mockCreateId,
}));

vi.mock("@/lib/claude/prompt-builder", () => ({
  buildTechCheckPrompt: vi.fn(() => "TECH_CHECK_PROMPT"),
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: mockResolvers.resolveAgentPrompt,
}));

vi.mock("@/lib/agent-config/providers", () => ({
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

function mockRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as import("next/server").NextRequest;
}

describe("POST /api/projects/[projectId]/qa/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.insertedValues = [];
    mockDb.updatedValues = [];
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
    mockDb.getQueue = [null];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/check/route"
    );
    const res = await POST(mockRequest({}), {
      params: Promise.resolve({ projectId: "missing" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("Project not found");
  });

  it("returns 400 when project has no git repo path", async () => {
    mockDb.getQueue = [
      { id: "proj-1", name: "Arij", gitRepoPath: null, spec: "Spec" },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/check/route"
    );
    const res = await POST(mockRequest({}), {
      params: Promise.resolve({ projectId: "proj-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("git repository");
  });

  it("creates a running QA report and launches a tech_check session", async () => {
    mockDb.getQueue = [
      { id: "proj-1", name: "Arij", gitRepoPath: "/tmp/repo", spec: "Spec" },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/check/route"
    );
    const res = await POST(
      mockRequest({ customPrompt: "Focus on architecture" }),
      {
        params: Promise.resolve({ projectId: "proj-1" }),
      },
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
