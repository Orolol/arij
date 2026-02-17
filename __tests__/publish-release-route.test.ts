/**
 * Tests for the publish release endpoint.
 *
 * Route flow (current implementation):
 * 1. Look up release by releaseId
 * 2. Check release has githubReleaseId (no draft → 400)
 * 3. Check release.projectId matches URL param (mismatch → 400)
 * 4. Look up project for githubOwnerRepo (missing → 400)
 * 5. Check if already published via getRelease (not draft → 409)
 * 6. Publish via publishRelease
 * 7. Update local record, log sync, return updated release
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let getCallCount = 0;
let getResults: Array<Record<string, unknown> | null> = [];

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ __eq: args })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => {
      const result = getResults[getCallCount] ?? null;
      getCallCount++;
      return result;
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ run: vi.fn() }),
      }),
    }),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  releases: { id: "id", projectId: "projectId" },
  projects: { id: "id" },
}));

const mockPublishRelease = vi.fn();
const mockGetRelease = vi.fn();

vi.mock("@/lib/github/releases", () => ({
  publishRelease: (...args: unknown[]) => mockPublishRelease(...args),
  getRelease: (...args: unknown[]) => mockGetRelease(...args),
}));

const mockLogSyncOperation = vi.fn();
vi.mock("@/lib/github/sync-log", () => ({
  logSyncOperation: (...args: unknown[]) => mockLogSyncOperation(...args),
}));

function mockRequest() {
  return {} as unknown as import("next/server").NextRequest;
}

describe("POST /releases/[releaseId]/publish", () => {
  beforeEach(() => {
    getCallCount = 0;
    getResults = [];
    vi.clearAllMocks();
  });

  it("returns 404 when release not found", async () => {
    // Call 1 (release lookup): null
    getResults = [null];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toContain("Release not found");
  });

  it("returns 400 when release has no GitHub draft", async () => {
    // Call 1 (release lookup): release with no githubReleaseId
    getResults = [
      { id: "rel-1", projectId: "proj-1", githubReleaseId: null },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("no draft release");
  });

  it("returns 400 when release does not belong to project", async () => {
    // Call 1 (release lookup): release with different projectId
    getResults = [
      { id: "rel-1", projectId: "proj-other", githubReleaseId: 100 },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("does not belong");
  });

  it("returns 400 when project has no GitHub config", async () => {
    // Call 1 (release lookup): valid release
    // Call 2 (project lookup): project without githubOwnerRepo
    getResults = [
      { id: "rel-1", projectId: "proj-1", githubReleaseId: 100 },
      { id: "proj-1", githubOwnerRepo: null },
    ];

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("no GitHub repository");
  });

  it("publishes a draft release successfully", async () => {
    const updatedRelease = {
      id: "rel-1",
      projectId: "proj-1",
      githubReleaseId: 100,
      githubReleaseUrl: "https://github.com/owner/repo/releases/tag/v1.0.0",
      pushedAt: "2026-02-17T00:00:00.000Z",
    };

    // Call 1 (release lookup): valid release with github draft
    // Call 2 (project lookup): project with github config
    // Call 3 (updated release lookup after publish)
    getResults = [
      { id: "rel-1", projectId: "proj-1", githubReleaseId: 100, gitTag: "v1.0.0" },
      { id: "proj-1", githubOwnerRepo: "owner/repo" },
      updatedRelease,
    ];

    mockGetRelease.mockResolvedValue({ id: 100, draft: true });

    mockPublishRelease.mockResolvedValue({
      id: 100,
      htmlUrl: "https://github.com/owner/repo/releases/tag/v1.0.0",
      draft: false,
      tagName: "v1.0.0",
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toBeDefined();
    expect(json.data.githubReleaseUrl).toContain("github.com");

    expect(mockPublishRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      releaseId: 100,
    });

    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        operation: "release",
        status: "success",
      })
    );
  });
});
