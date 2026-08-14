import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDbChainMock,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps. `sqlite` keeps the local stub
// because the helper only supplies an empty object.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return {
    ...dbModuleMock(),
    sqlite: {
      prepare: vi.fn(),
      transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    cancel: vi.fn(() => true),
  },
}));

vi.mock("@/lib/agent-sessions/backfill", () => ({
  runBackfillRecentSessionLastNonEmptyTextOnce: vi.fn(),
}));

describe("sessions/[sessionId] DELETE lifecycle guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("returns 409 and machine-readable code for invalid transitions", async () => {
    getDbChainMock().get.mockReturnValue({
      id: "sess-1",
      status: "completed",
      startedAt: "2026-02-12T00:00:00.000Z",
      endedAt: "2026-02-12T00:01:00.000Z",
      completedAt: "2026-02-12T00:01:00.000Z",
    });

    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/sessions/[sessionId]/route"
    );

    const response = await DELETE(mockNextRequest(), mockRouteContext({ projectId: "proj-1", sessionId: "sess-1" }));

    const json = await response.json();
    expect(response.status).toBe(409);
    expect(json.code).toBe("INVALID_SESSION_TRANSITION");
    expect(json.details).toMatchObject({
      sessionId: "sess-1",
      fromStatus: "completed",
      toStatus: "cancelled",
    });
  });

  it("includes lastNonEmptyText in session detail payload", async () => {
    getDbChainMock().get.mockReturnValue({
      id: "sess-2",
      status: "running",
      lastNonEmptyText: "Implementing API route",
      logsPath: null,
    });

    const { GET } = await import(
      "@/app/api/projects/[projectId]/sessions/[sessionId]/route"
    );

    const response = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1", sessionId: "sess-2" }));

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.lastNonEmptyText).toBe("Implementing API route");
  });
});
