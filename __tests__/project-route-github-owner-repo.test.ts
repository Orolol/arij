import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock records
// update(...).set(payload) payloads in dbMockState.updateCalls.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/sync/export", () => ({
  tryExportArjiJson: vi.fn(),
}));

describe("PATCH /api/projects/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("stores githubOwnerRepo when provided", async () => {
    dbMockState.getQueue = [
      { id: "proj-1", name: "Arij" },
      { id: "proj-1", name: "Arij", githubOwnerRepo: "octocat/hello-world" },
    ];

    const { PATCH } = await import("@/app/api/projects/[projectId]/route");
    const res = await PATCH(
      mockJsonRequest({ githubOwnerRepo: "octocat/hello-world" }),
      mockRouteContext({ projectId: "proj-1" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(dbMockState.updateCalls[0]).toEqual(
      expect.objectContaining({
        githubOwnerRepo: "octocat/hello-world",
      })
    );
    expect(json.data.githubOwnerRepo).toBe("octocat/hello-world");
  });
});
