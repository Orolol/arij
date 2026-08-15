import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockPullGitBranchWithConflictSupport = vi.hoisted(() => vi.fn());
const mockGetConflictFileDiffs = vi.hoisted(() => vi.fn());
const mockPushGitBranch = vi.hoisted(() => vi.fn());
const mockValidatePushPreconditions = vi.hoisted(() => vi.fn());
const mockGetBranchSyncStatus = vi.hoisted(() => vi.fn());
const mockGetCurrentGitBranch = vi.hoisted(() => vi.fn());
const mockWriteGitSyncLog = vi.hoisted(() => vi.fn());
const MockPushValidationError = vi.hoisted(
  () =>
    class PushValidationError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.name = "PushValidationError";
        this.code = code;
      }
    }
);

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/git/remote", () => ({
  pullGitBranchWithConflictSupport: mockPullGitBranchWithConflictSupport,
  getConflictFileDiffs: mockGetConflictFileDiffs,
  pushGitBranch: mockPushGitBranch,
  validatePushPreconditions: mockValidatePushPreconditions,
  getBranchSyncStatus: mockGetBranchSyncStatus,
  getCurrentGitBranch: mockGetCurrentGitBranch,
  PushValidationError: MockPushValidationError,
}));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: vi.fn(() => ({
    provider: "claude-code",
    model: "claude-opus-4-6",
    namedAgentId: null,
    name: null,
  })),
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "session-1"),
}));

vi.mock("@/lib/agent-sessions/lifecycle", () => ({
  createQueuedSession: vi.fn(),
  markSessionRunning: vi.fn(),
  markSessionTerminal: vi.fn(),
  isSessionLifecycleConflictError: vi.fn(() => false),
}));

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    start: vi.fn(),
    getStatus: vi.fn(() => ({ status: "completed", result: { success: true } })),
  },
}));

vi.mock("@/lib/agent-sessions/validate-resume", () => ({
  isResumableProvider: vi.fn(() => true),
}));

vi.mock("@/lib/github/sync-log", () => ({
  writeGitSyncLog: mockWriteGitSyncLog,
}));

describe("Project git sync routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockPullGitBranchWithConflictSupport.mockReset();
    mockGetConflictFileDiffs.mockReset();
    mockPushGitBranch.mockReset();
    mockValidatePushPreconditions.mockReset();
    mockGetBranchSyncStatus.mockReset();
    mockGetCurrentGitBranch.mockReset();
    mockWriteGitSyncLog.mockReset();
  });

  it("POST pull returns 409 with file-level diffs when conflicts are not auto-resolved", async () => {
    dbMockState.getQueue = [{ id: "proj-1", gitRepoPath: "/repo" }];
    mockPullGitBranchWithConflictSupport.mockResolvedValue({
      conflicted: true,
      summary: "merge failed",
      conflictedFiles: ["src/a.ts"],
    });
    mockGetConflictFileDiffs.mockResolvedValue([
      { filePath: "src/a.ts", diff: "@@ -1 +1 @@" },
    ]);

    const { POST } = await import(
      "@/app/api/projects/[projectId]/git/pull/route"
    );
    const res = await POST(
      mockJsonRequest({ branch: "feature/one", autoResolveConflicts: false }),
      mockRouteContext({ projectId: "proj-1" })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("merge conflicts");
    expect(json.code).toBe("merge_conflicts");
    expect(json.conflicted).toBe(true);
    expect(json.conflictedFiles).toEqual(["src/a.ts"]);
    expect(json.conflictDiffs).toHaveLength(1);
    expect(mockWriteGitSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        operation: "pull",
        status: "failed",
        branch: "feature/one",
      })
    );
  });

  it("POST pull starts conflict resolution agent when auto resolve is enabled", async () => {
    dbMockState.getQueue = [{ id: "proj-1", gitRepoPath: "/repo" }];
    mockPullGitBranchWithConflictSupport.mockResolvedValue({
      conflicted: true,
      summary: "merge failed",
      conflictedFiles: ["src/a.ts", "src/b.ts"],
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/git/pull/route"
    );
    const res = await POST(mockJsonRequest({ branch: "feature/one" }), mockRouteContext({ projectId: "proj-1" }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json.data.autoResolve).toBe(true);
    expect(json.data.sessionId).toBe("session-1");
    expect(json.data.conflictedFiles).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("POST push returns structured project and branch context", async () => {
    dbMockState.getQueue = [{ id: "proj-1", gitRepoPath: "/repo" }];
    mockValidatePushPreconditions.mockResolvedValue(undefined);
    mockPushGitBranch.mockResolvedValue({
      pushed: [{ to: "origin/feature/one" }],
      created: [],
      deleted: [],
      failed: false,
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/git/push/route"
    );
    const res = await POST(mockJsonRequest({ branch: "feature/one" }), mockRouteContext({ projectId: "proj-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(
      expect.objectContaining({
        action: "push",
        projectId: "proj-1",
        branch: "feature/one",
        remote: "origin",
      })
    );
    expect(mockWriteGitSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        operation: "push",
        status: "success",
        branch: "feature/one",
      })
    );
  });

  it("POST push returns 409 when validation fails", async () => {
    dbMockState.getQueue = [{ id: "proj-1", gitRepoPath: "/repo" }];
    mockValidatePushPreconditions.mockRejectedValue(
      new MockPushValidationError(
        "working_tree_dirty",
        "Push rejected: working tree has uncommitted changes."
      )
    );

    const { POST } = await import(
      "@/app/api/projects/[projectId]/git/push/route"
    );
    const res = await POST(mockJsonRequest({ branch: "feature/one" }), mockRouteContext({ projectId: "proj-1" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("uncommitted changes");
    expect(json.code).toBe("working_tree_dirty");
  });

  it("GET status returns ahead/behind for requested branch", async () => {
    dbMockState.getQueue = [{ id: "proj-1", gitRepoPath: "/repo" }];
    mockGetBranchSyncStatus.mockResolvedValue({
      branch: "feature/one",
      remote: "origin",
      remoteBranch: "origin/feature/one",
      ahead: 2,
      behind: 1,
      hasRemoteBranch: true,
    });

    const { GET } = await import(
      "@/app/api/projects/[projectId]/git/status/route"
    );
    const request = mockNextRequest({
      url: "http://localhost/api/projects/proj-1/git/status?branch=feature/one",
    });

    const res = await GET(request, mockRouteContext({ projectId: "proj-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.projectId).toBe("proj-1");
    expect(json.data.branch).toBe("feature/one");
    expect(json.data.ahead).toBe(2);
    expect(json.data.behind).toBe(1);
  });
});
