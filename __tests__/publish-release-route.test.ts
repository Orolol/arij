/**
 * Tests for the publish release endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let projectGetResult: Record<string, unknown> | null = null;
let releaseGetResult: Record<string, unknown> | null = null;
let getCallCount = 0;

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
      getCallCount++;
      // Call 1: project lookup
      if (getCallCount === 1) return projectGetResult;
      // Call 2: release lookup
      if (getCallCount === 2) return releaseGetResult;
      return null;
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

vi.mock("@/lib/github/releases", () => ({
  publishRelease: (...args: unknown[]) => mockPublishRelease(...args),
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
    projectGetResult = null;
    releaseGetResult = null;
    vi.clearAllMocks();
  });

  it("returns 404 when project not found", async () => {
    projectGetResult = null;

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toContain("Project not found");
  });

  it("returns 400 when project has no GitHub config", async () => {
    projectGetResult = {
      id: "proj-1",
      githubOwnerRepo: null,
    };

    const { POST } = await import(
      "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
    );

    const res = await POST(mockRequest(), {
      params: Promise.resolve({ projectId: "proj-1", releaseId: "rel-1" }),
    });

    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("GitHub integration not configured");
  });

  it("returns 404 when release not found", async () => {
    projectGetResult = {
      id: "proj-1",
      githubOwnerRepo: "owner/repo",
    };
    releaseGetResult = null;

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
    projectGetResult = {
      id: "proj-1",
      githubOwnerRepo: "owner/repo",
    };
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
    expect(json.error).toContain("no associated GitHub draft");
  });

  it("publishes a draft release successfully", async () => {
    projectGetResult = {
      id: "proj-1",
      githubOwnerRepo: "owner/repo",
    };
    releaseGetResult = {
      id: "rel-1",
      projectId: "proj-1",
      githubReleaseId: 100,
      gitTag: "v1.0.0",
    };

    mockPublishRelease.mockResolvedValue({
      id: 100,
      url: "https://github.com/owner/repo/releases/tag/v1.0.0",
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
    expect(json.data.published).toBe(true);
    expect(json.data.url).toContain("github.com");

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
