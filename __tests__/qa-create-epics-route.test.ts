import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
  insertedValues: [] as unknown[],
}));

const mockSpawnClaude = vi.hoisted(() => vi.fn());
const mockExtractJson = vi.hoisted(() => vi.fn());
const mockResolveAgent = vi.hoisted(() => vi.fn());
const mockCreateId = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn(() => mockDb.allQueue.shift() ?? []),
    get: vi.fn(() => mockDb.getQueue.shift() ?? null),
    insert: vi.fn().mockReturnValue({
      values: vi.fn((payload: unknown) => {
        mockDb.insertedValues.push(payload);
        return { run: vi.fn() };
      }),
    }),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  projects: { id: "id" },
  qaReports: { id: "id", projectId: "projectId" },
  epics: { position: "position", projectId: "projectId" },
  userStories: { id: "id" },
}));

vi.mock("@/lib/agent-config/providers", () => ({
  resolveAgentByNamedId: mockResolveAgent,
}));

vi.mock("@/lib/claude/spawn", () => ({
  spawnClaude: mockSpawnClaude,
}));

vi.mock("@/lib/claude/json-parser", () => ({
  extractJsonFromOutput: mockExtractJson,
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: mockCreateId,
}));

vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(() => ({
    spawn: vi.fn(() => ({
      promise: Promise.resolve({ success: true, result: "[]" }),
      kill: vi.fn(),
    })),
  })),
}));

describe("POST /api/projects/[projectId]/qa/reports/[reportId]/create-epics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.allQueue = [];
    mockDb.insertedValues = [];
    mockCreateId
      .mockReset()
      .mockReturnValueOnce("epic-1")
      .mockReturnValueOnce("story-1");
    mockResolveAgent.mockReturnValue({ provider: "claude-code", model: "claude-opus" });
    mockSpawnClaude.mockReturnValue({
      promise: Promise.resolve({ success: true, result: "AI JSON" }),
    });
    mockExtractJson.mockReturnValue([
      {
        title: "Stabilize Chat Resume Flow",
        description: "Fix resume failures and add fallback behavior.",
        priority: 2,
        type: "bug",
        userStories: [
          {
            title: "As a user, I want chat resumes to recover gracefully",
            description: "Ensure fallback to fresh prompt when expired.",
            acceptanceCriteria: "- [ ] Resume fallback works",
          },
        ],
      },
    ]);
  });

  it("returns 404 when report is missing or empty", async () => {
    mockDb.getQueue = [{ id: "proj-1", gitRepoPath: "/tmp/repo" }, null];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route"
    );
    const res = await POST({} as never, {
      params: Promise.resolve({ projectId: "proj-1", reportId: "missing" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("Report not found");
  });

  it("creates epics and stories from parsed QA output", async () => {
    mockDb.getQueue = [
      { id: "proj-1", gitRepoPath: "/tmp/repo" },
      { id: "report-1", projectId: "proj-1", reportContent: "# Findings", namedAgentId: null },
    ];
    mockDb.allQueue = [[{ position: 3 }]];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route"
    );
    const res = await POST({} as never, {
      params: Promise.resolve({ projectId: "proj-1", reportId: "report-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.epics).toHaveLength(1);
    expect(json.data.epics[0].id).toBe("epic-1");
    expect(mockDb.insertedValues).toHaveLength(2);
    expect(mockDb.insertedValues[0]).toEqual(
      expect.objectContaining({
        id: "epic-1",
        title: "Stabilize Chat Resume Flow",
        type: "bug",
      }),
    );
    expect(mockDb.insertedValues[1]).toEqual(
      expect.objectContaining({
        id: "story-1",
        epicId: "epic-1",
      }),
    );
  });
});
