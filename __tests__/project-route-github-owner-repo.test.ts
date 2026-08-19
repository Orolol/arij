import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

describe("PATCH /api/projects/[projectId] — clone provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  /** The real validatePath runs: the new path must be a real directory. */
  async function patchNewPath(newPath: string) {
    const { PATCH } = await import("@/app/api/projects/[projectId]/route");
    return PATCH(
      mockJsonRequest({ gitRepoPath: newPath }),
      mockRouteContext({ projectId: "proj-1" })
    );
  }

  it("clears the clone columns when gitRepoPath is repointed to another directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-repoint-"));
    try {
      dbMockState.getQueue = [
        {
          id: "proj-1",
          name: "Arij",
          gitRepoPath: "/home/user/arij/projects/Orolol-arij",
          cloneSource: "github",
          gitRemoteUrl: "https://github.com/Orolol/arij.git",
          defaultBranch: "develop",
        },
        {
          id: "proj-1",
          name: "Arij",
          gitRepoPath: dir,
          cloneSource: null,
          gitRemoteUrl: null,
          defaultBranch: null,
        },
      ];

      const res = await patchNewPath(dir);
      const json = await res.json();

      // The moved-to directory was not created by Arij: the ownership flag
      // and the metadata describing the old directory must not survive.
      expect(res.status).toBe(200);
      expect(dbMockState.updateCalls[0]).toEqual(
        expect.objectContaining({
          gitRepoPath: dir,
          cloneSource: null,
          gitRemoteUrl: null,
          defaultBranch: null,
        })
      );
      expect(json.data.cloneSource).toBeNull();
      expect(json.data.gitRemoteUrl).toBeNull();
      expect(json.data.defaultBranch).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the clone columns when gitRepoPath is unchanged", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-same-"));
    try {
      dbMockState.getQueue = [
        {
          id: "proj-1",
          name: "Arij",
          gitRepoPath: dir,
          cloneSource: "github",
          gitRemoteUrl: "https://github.com/Orolol/arij.git",
          defaultBranch: "develop",
        },
        { id: "proj-1", name: "Arij", gitRepoPath: dir, status: "building" },
      ];

      const { PATCH } = await import("@/app/api/projects/[projectId]/route");
      const res = await PATCH(
        mockJsonRequest({ gitRepoPath: dir, status: "building" }),
        mockRouteContext({ projectId: "proj-1" })
      );

      // Resending the stored path (e.g. a form that echoes it) is not a move:
      // the provenance stays intact.
      expect(res.status).toBe(200);
      expect(dbMockState.updateCalls[0]).not.toHaveProperty("cloneSource");
      expect(dbMockState.updateCalls[0]).not.toHaveProperty("gitRemoteUrl");
      expect(dbMockState.updateCalls[0]).not.toHaveProperty("defaultBranch");
      expect(dbMockState.updateCalls[0]).toEqual(
        expect.objectContaining({ status: "building" })
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
