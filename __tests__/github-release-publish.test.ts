import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

/* ------------------------------------------------------------------ */
/* Mock external modules                                               */
/* ------------------------------------------------------------------ */
// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "log-id"),
}));

const mockPublishRelease = vi.fn();
const mockGetRelease = vi.fn();
vi.mock("@/lib/github/releases", () => ({
  publishRelease: mockPublishRelease,
  getRelease: mockGetRelease,
}));

const mockLogSyncOperation = vi.fn();
vi.mock("@/lib/github/sync-log", () => ({
  logSyncOperation: mockLogSyncOperation,
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function createMockRequest() {
  return mockNextRequest({
    url: "http://localhost/api/projects/proj_1/releases/rel_1/publish",
    method: "POST",
  });
}

/* ------------------------------------------------------------------ */
/* Tests — updated to match current route flow:                        */
/* 1. release lookup  2. check githubReleaseId  3. check projectId     */
/* 4. project lookup  5. getRelease (check draft) 6. publishRelease   */
/* ------------------------------------------------------------------ */
describe("Publish release endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("publishes a draft release successfully", async () => {
    const updatedRelease = {
      id: "rel_1",
      projectId: "proj_1",
      githubReleaseId: 42,
      githubReleaseUrl: "https://github.com/owner/repo/releases/tag/v1.0.0",
      pushedAt: "2026-02-17T00:00:00.000Z",
    };

    // Call 1: release lookup, Call 2: project lookup, Call 3: updated release
    dbMockState.getQueue = [
      { id: "rel_1", projectId: "proj_1", githubReleaseId: 42, gitTag: "v1.0.0" },
      { id: "proj_1", name: "Test Project", githubOwnerRepo: "owner/repo" },
      updatedRelease,
    ];

    mockGetRelease.mockResolvedValue({ id: 42, draft: true });

    mockPublishRelease.mockResolvedValue({
      htmlUrl: "https://github.com/owner/repo/releases/tag/v1.0.0",
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(
      createMockRequest(),
      mockRouteContext({ projectId: "proj_1", releaseId: "rel_1" }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toBeDefined();
    expect(json.data.githubReleaseUrl).toContain("github.com");

    expect(mockPublishRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      releaseId: 42,
    });

    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_1",
        operation: "release",
        status: "success",
      })
    );

    // Verify the detail includes "publish" action
    const logCall = mockLogSyncOperation.mock.calls[0][0];
    expect(logCall.detail.action).toBe("publish");
  });

  it("returns 404 when release not found", async () => {
    // Call 1: release lookup returns null
    dbMockState.getQueue = [null];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(
      createMockRequest(),
      mockRouteContext({ projectId: "proj_1", releaseId: "rel_1" }),
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("Release not found");
  });

  it("returns 400 when project has no GitHub config", async () => {
    // Call 1: release with githubReleaseId, Call 2: project without github
    dbMockState.getQueue = [
      { id: "rel_1", projectId: "proj_1", githubReleaseId: 42 },
      { id: "proj_1", name: "Test Project", githubOwnerRepo: null },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(
      createMockRequest(),
      mockRouteContext({ projectId: "proj_1", releaseId: "rel_1" }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("no GitHub repository");
  });

  it("returns 400 when release has no GitHub draft", async () => {
    // Call 1: release without githubReleaseId
    dbMockState.getQueue = [
      { id: "rel_1", projectId: "proj_1", githubReleaseId: null },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(
      createMockRequest(),
      mockRouteContext({ projectId: "proj_1", releaseId: "rel_1" }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("no draft release");
  });

  it("returns 400 when release does not belong to project", async () => {
    // Call 1: release with different projectId
    dbMockState.getQueue = [
      { id: "rel_1", projectId: "proj_other", githubReleaseId: 42 },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(
      createMockRequest(),
      mockRouteContext({ projectId: "proj_1", releaseId: "rel_1" }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("does not belong");
  });

  it("returns 409 when release is already published", async () => {
    // Call 1: release, Call 2: project
    dbMockState.getQueue = [
      { id: "rel_1", projectId: "proj_1", githubReleaseId: 42, gitTag: "v1.0.0" },
      { id: "proj_1", name: "Test Project", githubOwnerRepo: "owner/repo" },
    ];

    mockGetRelease.mockResolvedValue({ id: 42, draft: false });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(
      createMockRequest(),
      mockRouteContext({ projectId: "proj_1", releaseId: "rel_1" }),
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already published");
  });
});
