/**
 * Tests for the publish release endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let releaseGetResult: Record<string, unknown> | null = null;
let projectGetResult: Record<string, unknown> | null = null;
let getCallCount = 0;

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => {
      getCallCount++;
      // Call 1: release lookup
      if (getCallCount === 1) return releaseGetResult;
      // Call 2: project lookup
      if (getCallCount === 2) return projectGetResult;
      // Call 3: updated release re-fetch
      return releaseGetResult;
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

vi.mock("@/lib/github/client", () => ({
  createOctokit: vi.fn(() => ({ repos: {} })),
  parseOwnerRepo: vi.fn((s: string) => {
    const [owner, repo] = s.split("/");
    return { owner, repo };
  }),
}));

const mockPublishRelease = vi.fn();
const mockGetRelease = vi.fn();

vi.mock("@/lib/github/releases", () => ({
  publishRelease: (...args: unknown[]) => mockPublishRelease(...args),
  getRelease: (...args: unknown[]) => mockGetRelease(...args),
}));

vi.mock("@/lib/github/sync-log", () => ({
  logSyncOperation: vi.fn(),
}));

function mockRequest() {
  return {} as unknown as import("next/server").NextRequest;
}

describe("POST /releases/[releaseId]/publish", () => {
  beforeEach(() => {
    getCallCount = 0;
    releaseGetResult = null;
    projectGetResult = null;
    vi.clearAllMocks();
  });

  it("returns 404 when release not found", async () => {
    releaseGetResult = null;

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe("Release not found");
  });

  it("returns 400 when release has no githubReleaseId", async () => {
    releaseGetResult = {
      id: "rel-1",
      projectId: "proj-1",
      githubReleaseId: null,
    };

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("not published to GitHub yet");
  });

  it("returns 400 when release belongs to different project", async () => {
    releaseGetResult = {
      id: "rel-1",
      projectId: "proj-other",
      githubReleaseId: 100,
    };

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("does not belong to this project");
  });

  it("returns 409 when release is already published", async () => {
    releaseGetResult = {
      id: "rel-1",
      projectId: "proj-1",
      githubReleaseId: 100,
    };
    projectGetResult = {
      id: "proj-1",
      githubOwnerRepo: "owner/repo",
    };

    mockGetRelease.mockResolvedValue({
      id: 100,
      htmlUrl: "https://github.com/owner/repo/releases/1",
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
    expect(res.status).toBe(409);
    expect(json.error).toContain("already published");
  });

  it("publishes a draft release successfully", async () => {
    releaseGetResult = {
      id: "rel-1",
      projectId: "proj-1",
      githubReleaseId: 100,
    };
    projectGetResult = {
      id: "proj-1",
      githubOwnerRepo: "owner/repo",
    };

    mockGetRelease.mockResolvedValue({
      id: 100,
      htmlUrl: "https://github.com/owner/repo/releases/1",
      draft: true,
      tagName: "v1.0.0",
    });

    mockPublishRelease.mockResolvedValue({
      id: 100,
      htmlUrl: "https://github.com/owner/repo/releases/1",
      draft: false,
      tagName: "v1.0.0",
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    expect(res.status).toBe(200);
    expect(mockPublishRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      releaseId: 100,
    });
  });
});
