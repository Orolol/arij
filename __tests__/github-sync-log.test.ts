/**
 * Tests for the git sync log service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const valuesMock = vi.fn().mockReturnValue({ run: vi.fn() });
insertMock.mockReturnValue({ values: valuesMock });

vi.mock("@/lib/db", () => ({
  db: {
    insert: insertMock,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  gitSyncLog: { _: "gitSyncLog" },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "sync-log-id"),
}));

describe("logSyncOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({ values: valuesMock });
    valuesMock.mockReturnValue({ run: vi.fn() });
  });

  it("inserts a sync log entry with detail", async () => {
    const { logSyncOperation } = await import("@/lib/github/sync-log");

    logSyncOperation("proj-1", "tag_push", null, "success", {
      tag: "v1.0.0",
    });

    expect(insertMock).toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sync-log-id",
        projectId: "proj-1",
        operation: "tag_push",
        branch: null,
        status: "success",
        detail: JSON.stringify({ tag: "v1.0.0" }),
      })
    );
  });

  it("inserts a sync log entry without detail", async () => {
    const { logSyncOperation } = await import("@/lib/github/sync-log");

    logSyncOperation("proj-1", "release_publish", "main", "failure");

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "release_publish",
        branch: "main",
        status: "failure",
        detail: null,
      })
    );
  });
});
