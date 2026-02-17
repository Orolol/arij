import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/* Hoisted mock state                                                  */
/* ------------------------------------------------------------------ */
const mockDbState = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: unknown; payload: unknown }>,
  updateCalls: [] as Array<{ table: unknown; values: unknown }>,
  allQueue: [] as unknown[],
  getQueue: [] as unknown[],
}));
const mockGitAddTag = vi.hoisted(() => vi.fn());
const mockGitTag = vi.hoisted(() => vi.fn());
const mockGitPush = vi.hoisted(() => vi.fn());
const mockCreateReleaseBranchAndCommitChangelog = vi.hoisted(() => vi.fn());

const mockSchema = vi.hoisted(() => ({
  releases: { __name: "releases", id: "id", projectId: "projectId", epicIds: "epicIds" },
  projects: { __name: "projects", id: "id" },
  epics: { __name: "epics", id: "id", projectId: "projectId", status: "status" },
  userStories: { __name: "user_stories", epicId: "epicId" },
  settings: { __name: "settings", key: "key" },
  agentSessions: { __name: "agent_sessions", id: "id", projectId: "projectId", provider: "provider", cliSessionId: "cliSessionId", claudeSessionId: "claudeSessionId" },
  gitSyncLog: { __name: "git_sync_log" },
  agentProviderDefaults: { __name: "agent_provider_defaults" },
  namedAgents: { __name: "named_agents" },
}));

/* ------------------------------------------------------------------ */
/* Mock external modules                                               */
/* ------------------------------------------------------------------ */
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ __eq: args })),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => {
  function createChain() {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(),
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      set: vi.fn(),
      transaction: vi.fn(),
    };

    chain.select.mockReturnValue(chain);
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.all.mockImplementation(() => mockDbState.allQueue.shift() ?? []);
    chain.get.mockImplementation(() => mockDbState.getQueue.shift() ?? null);
    chain.insert.mockImplementation((table: unknown) => ({
      values: vi.fn((payload: unknown) => {
        mockDbState.insertCalls.push({ table, payload });
        return { run: vi.fn() };
      }),
    }));
    chain.update.mockImplementation((table: unknown) => ({
      set: vi.fn((values: unknown) => {
        mockDbState.updateCalls.push({ table, values });
        return {
          where: vi.fn().mockReturnValue({ run: vi.fn() }),
        };
      }),
    }));
    // transaction(fn) calls fn(tx) where tx has the same interface
    chain.transaction.mockImplementation((fn: (tx: unknown) => void) => {
      const tx = createChain();
      fn(tx);
    });

    return chain;
  }

  return { db: createChain() };
});

vi.mock("@/lib/db/schema", () => mockSchema);
vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "test-release-id"),
}));

// Mock simple-git
vi.mock("simple-git", () => ({
  default: vi.fn(() => ({
    addTag: mockGitAddTag,
    tag: mockGitTag,
    push: mockGitPush,
  })),
}));

// Mock Claude spawn (used for changelog generation)
vi.mock("@/lib/claude/spawn", () => ({
  spawnClaude: vi.fn(() => ({
    promise: Promise.resolve({ success: false }),
    sessionId: "mock-session",
  })),
}));

vi.mock("@/lib/claude/json-parser", () => ({
  parseClaudeOutput: vi.fn(() => ({ content: "" })),
}));

vi.mock("@/lib/git/release", () => ({
  createReleaseBranchAndCommitChangelog: mockCreateReleaseBranchAndCommitChangelog,
}));

const mockCreateDraftRelease = vi.fn();
vi.mock("@/lib/github/releases", () => ({
  createDraftRelease: mockCreateDraftRelease,
  publishRelease: vi.fn(),
}));

const mockLogSyncOperation = vi.fn();
vi.mock("@/lib/github/sync-log", () => ({
  logSyncOperation: mockLogSyncOperation,
}));

vi.mock("@/lib/activity-registry", () => ({
  activityRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

// Mock new modules added for release flow
vi.mock("@/lib/agent-sessions/lifecycle", () => ({
  createQueuedSession: vi.fn(),
  markSessionRunning: vi.fn(),
  markSessionTerminal: vi.fn(),
  isSessionLifecycleConflictError: vi.fn(() => false),
}));

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    start: vi.fn(),
    getStatus: vi.fn(() => null),
  },
}));

vi.mock("@/lib/agent-sessions/validate-resume", () => ({
  isResumableProvider: vi.fn(() => false),
}));

vi.mock("@/lib/agent-config/providers", () => ({
  resolveAgentByNamedId: vi.fn(() => ({
    provider: "claude-code",
    name: "Claude Code",
    namedAgentId: null,
    model: null,
  })),
}));

const mockApplyTransition = vi.fn(() => ({ valid: true }));
vi.mock("@/lib/workflow/transition-service", () => ({
  applyTransition: (...args: unknown[]) => mockApplyTransition(...args),
}));

vi.mock("@/lib/events/emit", () => ({
  emitReleaseCreated: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function createMockRequest(body: unknown): Request {
  return new Request("http://localhost/api/projects/proj_1/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */
describe("Release creation with pushToGitHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.insertCalls = [];
    mockDbState.updateCalls = [];
    mockDbState.allQueue = [];
    mockDbState.getQueue = [];
    mockGitAddTag.mockReset();
    mockGitTag.mockReset();
    mockGitPush.mockReset();
    mockCreateReleaseBranchAndCommitChangelog.mockReset();
    mockCreateReleaseBranchAndCommitChangelog.mockResolvedValue({
      releaseBranch: "release/v1.0.0",
      changelogCommitted: true,
      commitHash: "abc123",
    });
  });

  it("creates a local-only release when pushToGitHub is false", async () => {
    // Setup: project without GitHub, selected epics, release result
    mockDbState.getQueue = [
      { id: "proj_1", name: "Test Project", gitRepoPath: "/tmp/repo", githubOwnerRepo: null },
      { id: "test-release-id", version: "1.0.0" },
    ];
    mockDbState.allQueue = [
      [{ id: "ep_1", title: "Epic 1", description: "desc", status: "done" }],
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/route"
    );

    const req = createMockRequest({
      version: "1.0.0",
      epicIds: ["ep_1"],
      generateChangelog: false,
      pushToGitHub: false,
    });

    const res = await POST(req as any, {
      params: Promise.resolve({ projectId: "proj_1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data).toBeDefined();

    // GitHub functions should NOT have been called
    expect(mockCreateDraftRelease).not.toHaveBeenCalled();
    expect(mockLogSyncOperation).not.toHaveBeenCalled();
    expect(mockCreateReleaseBranchAndCommitChangelog).toHaveBeenCalled();
  });

  it("pushes tag and creates draft release when pushToGitHub is true", async () => {
    // Setup: project with GitHub configured
    mockDbState.getQueue = [
      { id: "proj_1", name: "Test Project", gitRepoPath: "/tmp/repo", githubOwnerRepo: "owner/repo" },
      { id: "test-release-id", version: "1.0.0", githubReleaseId: 99, githubReleaseUrl: "https://github.com/owner/repo/releases/99" },
    ];
    mockDbState.allQueue = [
      [{ id: "ep_1", title: "Epic 1", description: "desc", status: "done" }],
    ];

    mockCreateDraftRelease.mockResolvedValue({
      id: 99,
      url: "https://github.com/owner/repo/releases/99",
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/route"
    );

    const req = createMockRequest({
      version: "1.0.0",
      title: "First Release",
      epicIds: ["ep_1"],
      generateChangelog: false,
      pushToGitHub: true,
    });

    const res = await POST(req as any, {
      params: Promise.resolve({ projectId: "proj_1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data).toBeDefined();

    expect(mockCreateReleaseBranchAndCommitChangelog).toHaveBeenCalledWith(
      "/tmp/repo",
      "1.0.0",
      expect.any(String)
    );

    // Verify tag was created against the release commit hash, not HEAD
    expect(mockGitTag).toHaveBeenCalledWith(["v1.0.0", "abc123"]);

    // createDraftRelease should have been called
    expect(mockCreateDraftRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        tag: "v1.0.0",
        title: "v1.0.0 — First Release",
      })
    );

    // Sync log should have entries for tag push and release create
    expect(mockLogSyncOperation).toHaveBeenCalledTimes(2);
    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_1",
        operation: "tag_push",
        status: "success",
      })
    );
    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_1",
        operation: "release",
        status: "success",
      })
    );
  });

  it("creates local release even when GitHub push fails", async () => {
    mockDbState.getQueue = [
      { id: "proj_1", name: "Test Project", gitRepoPath: "/tmp/repo", githubOwnerRepo: "owner/repo" },
      { id: "test-release-id", version: "2.0.0" },
    ];
    mockDbState.allQueue = [
      [{ id: "ep_1", title: "Epic 1", description: "desc", status: "done" }],
    ];

    mockGitPush.mockRejectedValue(new Error("Network error"));
    mockCreateDraftRelease.mockRejectedValue(new Error("API error"));

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/route"
    );

    const req = createMockRequest({
      version: "2.0.0",
      epicIds: ["ep_1"],
      generateChangelog: false,
      pushToGitHub: true,
    });

    const res = await POST(req as any, {
      params: Promise.resolve({ projectId: "proj_1" }),
    });
    const json = await res.json();

    // Release still created successfully
    expect(res.status).toBe(201);
    expect(json.data).toBeDefined();

    // But errors reported
    expect(json.githubErrors).toBeDefined();
    expect(json.githubErrors).toHaveLength(2);
    expect(json.githubErrors[0]).toContain("Tag push failed");
    expect(json.githubErrors[1]).toContain("GitHub release creation failed");

    // Failures logged
    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "tag_push",
        status: "failure",
      })
    );
    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "release",
        status: "failure",
      })
    );
  });

  it("skips GitHub operations when project has no githubOwnerRepo", async () => {
    mockDbState.getQueue = [
      { id: "proj_1", name: "Test Project", gitRepoPath: "/tmp/repo", githubOwnerRepo: null },
      { id: "test-release-id", version: "1.0.0" },
    ];
    mockDbState.allQueue = [
      [{ id: "ep_1", title: "Epic 1", description: "desc", status: "done" }],
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/route"
    );

    const req = createMockRequest({
      version: "1.0.0",
      epicIds: ["ep_1"],
      generateChangelog: false,
      pushToGitHub: true, // true but no github config
    });

    const res = await POST(req as any, {
      params: Promise.resolve({ projectId: "proj_1" }),
    });

    expect(res.status).toBe(201);
    expect(mockCreateDraftRelease).not.toHaveBeenCalled();
  });

  it("returns 400 when version is missing", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/route"
    );

    const req = createMockRequest({
      epicIds: ["ep_1"],
    });

    const res = await POST(req as any, {
      params: Promise.resolve({ projectId: "proj_1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("version");
  });

  it("returns 400 when epicIds is empty", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/route"
    );

    const req = createMockRequest({
      version: "1.0.0",
      epicIds: [],
    });

    const res = await POST(req as any, {
      params: Promise.resolve({ projectId: "proj_1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("epicIds");
  });
});
