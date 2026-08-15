import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  getDbChainMock,
  resetDbMockState,
} from "@/__tests__/helpers/db-mock";
import { gitSyncLog } from "@/lib/db/schema";

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "test-id-123"),
}));

describe("logSyncOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("inserts a sync log entry with all fields", async () => {
    const { logSyncOperation } = await import("@/lib/github/sync-log");

    logSyncOperation({
      projectId: "proj_1",
      operation: "push",
      branch: "main",
      status: "success",
      detail: "Pushed 3 commits",
    });

    expect(dbMockState.insertCalls).toHaveLength(1);
    expect(getDbChainMock().insert).toHaveBeenCalledWith(gitSyncLog);
    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        id: "test-id-123",
        projectId: "proj_1",
        operation: "push",
        branch: "main",
        status: "success",
        detail: "Pushed 3 commits",
      })
    );
  });

  it("handles optional fields (branch, detail) as null", async () => {
    const { logSyncOperation } = await import("@/lib/github/sync-log");

    logSyncOperation({
      projectId: "proj_2",
      operation: "fetch",
      status: "failure",
    });

    expect(dbMockState.insertCalls).toHaveLength(1);
    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        projectId: "proj_2",
        operation: "fetch",
        branch: null,
        status: "failure",
        detail: null,
      })
    );
  });

  it("exposes writeGitSyncLog as an identity alias of logSyncOperation", async () => {
    const { writeGitSyncLog, logSyncOperation } = await import(
      "@/lib/github/sync-log"
    );

    expect(writeGitSyncLog).toBe(logSyncOperation);
  });

  it("writes machine-readable JSON detail payloads via writeGitSyncLog", async () => {
    const { writeGitSyncLog } = await import("@/lib/github/sync-log");

    writeGitSyncLog({
      projectId: "proj-1",
      operation: "pull",
      status: "failed",
      branch: "feature/one",
      detail: {
        code: "ff_only_conflict",
        remote: "origin",
      },
    });

    expect(dbMockState.insertCalls).toHaveLength(1);
    const payload = dbMockState.insertCalls[0] as Record<
      string,
      unknown
    >;
    expect(payload).toEqual(
      expect.objectContaining({
        projectId: "proj-1",
        operation: "pull",
        status: "failed",
        branch: "feature/one",
      })
    );
    expect(JSON.parse(String(payload.detail))).toEqual({
      code: "ff_only_conflict",
      remote: "origin",
    });
  });

  it("inserts a release sync log entry with detail object", async () => {
    const { logSyncOperation } = await import("@/lib/github/sync-log");

    logSyncOperation({
      projectId: "proj-1",
      operation: "tag_push",
      status: "success",
      detail: { tag: "v1.0.0" },
    });

    expect(dbMockState.insertCalls).toHaveLength(1);
    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        id: "test-id-123",
        projectId: "proj-1",
        operation: "tag_push",
        branch: null,
        status: "success",
        detail: JSON.stringify({ tag: "v1.0.0" }),
      })
    );
  });
});

describe("getRecentSyncLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("returns sync log entries for the project", async () => {
    const mockLogs = [
      {
        id: "log_1",
        projectId: "proj_1",
        operation: "push",
        branch: "main",
        status: "success",
        detail: null,
        createdAt: "2025-01-01T00:00:00Z",
      },
      {
        id: "log_2",
        projectId: "proj_1",
        operation: "pull",
        branch: "dev",
        status: "failure",
        detail: "non-fast-forward",
        createdAt: "2025-01-01T01:00:00Z",
      },
    ];

    dbMockState.allQueue = [mockLogs];

    const { getRecentSyncLogs } = await import("@/lib/github/sync-log");
    const result = getRecentSyncLogs("proj_1");

    expect(result).toHaveLength(2);
    expect(result[0].operation).toBe("push");
    expect(result[1].status).toBe("failure");
  });

  it("returns empty array when no logs exist", async () => {
    dbMockState.allQueue = [[]];

    const { getRecentSyncLogs } = await import("@/lib/github/sync-log");
    const result = getRecentSyncLogs("proj_1");

    expect(result).toHaveLength(0);
  });
});
