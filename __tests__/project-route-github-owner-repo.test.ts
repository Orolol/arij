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

  it("never writes cloneSource, whatever the request asks for", async () => {
    // `clone_source` authorises deleting a directory. If PATCH could set it,
    // a user-supplied project sitting under the projects root could be
    // reclassified as Arij's and then removed with its own contents.
    dbMockState.getQueue = [
      { id: "proj-1", name: "Arij", cloneSource: null },
      { id: "proj-1", name: "Arij", cloneSource: null },
    ];

    const { PATCH } = await import("@/app/api/projects/[projectId]/route");
    const res = await PATCH(
      mockJsonRequest({
        name: "Arij",
        cloneSource: "github",
        gitRemoteUrl: "https://github.com/attacker/repo.git",
      }),
      mockRouteContext({ projectId: "proj-1" })
    );

    expect(res.status).toBe(200);
    expect(dbMockState.updateCalls[0]).not.toHaveProperty("cloneSource");
    expect(dbMockState.updateCalls[0]).not.toHaveProperty("gitRemoteUrl");
  });

  it("refuses to re-point an Arij-managed clone at another directory", async () => {
    // Its deletion rights are tied to the path recorded at creation; moving the
    // pointer would carry them to a directory that never earned them.
    dbMockState.getQueue = [
      {
        id: "proj-1",
        name: "Arij",
        cloneSource: "github",
        gitRepoPath: "/workspace/projects/owner-repo",
      },
    ];

    const { PATCH } = await import("@/app/api/projects/[projectId]/route");
    const res = await PATCH(
      mockJsonRequest({ gitRepoPath: "/workspace/projects/someone-elses" }),
      mockRouteContext({ projectId: "proj-1" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/cloned by Arij/i);
    expect(dbMockState.updateCalls).toHaveLength(0);
  });
});
