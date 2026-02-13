import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockEpic = {
  id: "epic1",
  branchName: "feature/epic1",
  projectId: "proj1",
  status: "review",
};
const mockProject = {
  id: "proj1",
  gitRepoPath: "/tmp/repo",
};
const mockSession = {
  worktreePath: "/tmp/worktree",
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    all: vi.fn(() => [mockSession]),
    get: vi.fn((arg: unknown) => {
      // Return project or epic based on call context
      return mockProject;
    }),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    run: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
  },
}));

const mockMergeWorktree = vi.hoisted(() => vi.fn());
vi.mock("@/lib/git/manager", () => ({
  mergeWorktree: mockMergeWorktree,
}));

vi.mock("@/lib/sync/export", () => ({
  tryExportArjiJson: vi.fn(),
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: () => "test-session-id",
}));

const mockStart = vi.hoisted(() => vi.fn());
const mockGetStatus = vi.hoisted(() => vi.fn(() => ({ status: "completed", result: { success: true } })));
vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    start: mockStart,
    getStatus: mockGetStatus,
  },
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: vi.fn(() => "Merge system prompt"),
}));

vi.mock("@/lib/agent-sessions/lifecycle", () => ({
  createQueuedSession: vi.fn(),
  markSessionRunning: vi.fn(),
  markSessionTerminal: vi.fn(),
  isSessionLifecycleConflictError: () => false,
}));

vi.mock("@/lib/agents/concurrency", () => ({
  getRunningSessionForTarget: vi.fn(() => null),
}));

vi.mock("@/lib/db/schema", () => ({
  projects: {},
  epics: {},
  agentSessions: {},
}));

vi.mock("fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("path", () => ({
  default: {
    join: (...args: string[]) => args.join("/"),
  },
}));

// Need to mock db.get to return different values for project vs epic
import { db } from "@/lib/db";

function mockRequest(body?: Record<string, unknown>) {
  return {
    json: () => body ? Promise.resolve(body) : Promise.reject(new Error("no body")),
  } as unknown as import("next/server").NextRequest;
}

describe("POST /api/projects/[projectId]/epics/[epicId]/merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: db.get returns project first, then epic
    let callCount = 0;
    (db.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockProject;
      return mockEpic;
    });
    (db.all as ReturnType<typeof vi.fn>).mockReturnValue([mockSession]);
  });

  it("merges successfully without autoAgent", async () => {
    mockMergeWorktree.mockResolvedValue({ merged: true, commitHash: "abc123" });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/merge/route"
    );
    const res = await POST(
      mockRequest(),
      { params: Promise.resolve({ projectId: "proj1", epicId: "epic1" }) }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.merged).toBe(true);
    expect(json.data.commitHash).toBe("abc123");
  });

  it("returns 500 when merge fails without autoAgent", async () => {
    mockMergeWorktree.mockResolvedValue({ merged: false, error: "Conflict in file.ts" });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/merge/route"
    );
    const res = await POST(
      mockRequest(),
      { params: Promise.resolve({ projectId: "proj1", epicId: "epic1" }) }
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("Conflict");
  });

  it("launches merge-fix agent when autoAgent is true and merge fails", async () => {
    mockMergeWorktree.mockResolvedValue({ merged: false, error: "Conflict in file.ts" });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/merge/route"
    );
    const res = await POST(
      mockRequest({ autoAgent: true }),
      { params: Promise.resolve({ projectId: "proj1", epicId: "epic1" }) }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.autoAgent).toBe(true);
    expect(json.data.sessionId).toBe("test-session-id");
    expect(json.data.merged).toBe(false);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("does not launch agent when autoAgent is false and merge fails", async () => {
    mockMergeWorktree.mockResolvedValue({ merged: false, error: "Conflict" });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/merge/route"
    );
    const res = await POST(
      mockRequest({ autoAgent: false }),
      { params: Promise.resolve({ projectId: "proj1", epicId: "epic1" }) }
    );

    expect(res.status).toBe(500);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("does not launch agent when merge succeeds (regardless of autoAgent)", async () => {
    mockMergeWorktree.mockResolvedValue({ merged: true, commitHash: "def456" });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/merge/route"
    );
    const res = await POST(
      mockRequest({ autoAgent: true }),
      { params: Promise.resolve({ projectId: "proj1", epicId: "epic1" }) }
    );

    const json = await res.json();
    expect(json.data.merged).toBe(true);
    expect(mockStart).not.toHaveBeenCalled();
  });
});
