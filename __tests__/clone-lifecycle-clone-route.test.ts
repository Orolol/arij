import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockJsonRequest,
  mockNextRequest,
  resetDbMockState,
} from "@/__tests__/helpers/db-mock";

/**
 * POST /api/projects/clone — the endpoint the Import flow calls before
 * /api/projects/import. Its contract matters to the resume story: a reused
 * clone has to be reported as such, and a destination holding someone else's
 * repository has to be a 409 rather than a silent overwrite.
 */

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const mockCloneGitHubRepository = vi.hoisted(() => vi.fn());
vi.mock("@/lib/git/clone", async () => {
  const actual = await vi.importActual<typeof import("@/lib/git/clone")>(
    "@/lib/git/clone"
  );
  return { ...actual, cloneGitHubRepository: mockCloneGitHubRepository };
});

const mockGetToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github/client", () => ({
  getGitHubTokenFromSettings: mockGetToken,
  GITHUB_PAT_SETTING_KEY: "github_pat",
}));

const mockEnsureProjectsRoot = vi.hoisted(() => vi.fn());
const mockResolveProjectsRoot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/projects/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/projects/workspace")>(
    "@/lib/projects/workspace"
  );
  return {
    ...actual,
    ensureProjectsRoot: mockEnsureProjectsRoot,
    resolveProjectsRoot: mockResolveProjectsRoot,
  };
});

const mockLogSyncOperation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github/sync-log", () => ({
  logSyncOperation: mockLogSyncOperation,
}));

const ROOT = "/home/me/arij/projects";
const DEST = `${ROOT}/owner-repo`;

function cloneResult(overrides: Record<string, unknown> = {}) {
  return {
    path: DEST,
    owner: "owner",
    repo: "repo",
    ownerRepo: "owner/repo",
    remoteUrl: "https://github.com/owner/repo.git",
    defaultBranch: "main",
    reused: false,
    destinationState: "absent",
    durationMs: 1234,
    ...overrides,
  };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/projects/clone/route");
  return POST(mockJsonRequest(body, { url: "http://localhost:3000/api/projects/clone" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
  mockResolveProjectsRoot.mockReturnValue(ROOT);
  mockEnsureProjectsRoot.mockReturnValue(ROOT);
  mockGetToken.mockReturnValue(null);
  mockCloneGitHubRepository.mockResolvedValue(cloneResult());
});

describe("POST /api/projects/clone", () => {
  it("returns the destination the import step then analyses", async () => {
    const json = await (await post({ url: "https://github.com/owner/repo" })).json();

    expect(json.data).toMatchObject({
      path: DEST,
      ownerRepo: "owner/repo",
      remoteUrl: "https://github.com/owner/repo.git",
      defaultBranch: "main",
      reused: false,
      projectsRoot: ROOT,
    });
  });

  it("reports a reused clone so the UI can skip straight to analysis", async () => {
    mockCloneGitHubRepository.mockResolvedValue(
      cloneResult({ reused: true, destinationState: "healthy_match", durationMs: 90 })
    );

    const json = await (await post({ url: "owner/repo" })).json();

    expect(json.data.reused).toBe(true);
    expect(json.data.path).toBe(DEST);
  });

  it("passes the stored PAT to the clone service", async () => {
    mockGetToken.mockReturnValue("ghp_secret");

    await post({ url: "owner/repo" });

    expect(mockCloneGitHubRepository).toHaveBeenCalledWith({
      input: "owner/repo",
      destination: DEST,
      token: "ghp_secret",
    });
  });

  it("rejects input that is not a GitHub repository", async () => {
    const response = await post({ url: "https://gitlab.com/owner/repo" });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/not a github repository/i);
    expect(mockCloneGitHubRepository).not.toHaveBeenCalled();
  });

  it("rejects a missing url with the standard { error, details } shape", async () => {
    const response = await post({});
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details.url).toBeDefined();
  });

  it("rejects an empty url", async () => {
    expect((await post({ url: "" })).status).toBe(400);
  });

  it("rejects an over-length url without reaching the git layer", async () => {
    const response = await post({
      url: `https://github.com/octocat/${"a".repeat(500)}`,
    });

    expect(response.status).toBe(400);
    expect(mockCloneGitHubRepository).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const { POST } = await import("@/app/api/projects/clone/route");
    const response = await POST(
      mockNextRequest({ method: "POST", body: "{not json" })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid JSON body");
  });

  it("rejects a traversal attempt without calling the clone service", async () => {
    expect((await post({ url: "octocat/.." })).status).toBe(400);
    expect(mockCloneGitHubRepository).not.toHaveBeenCalled();
  });

  it("returns 409 when the destination holds a different repository", async () => {
    const { CloneConflictError } = await vi.importActual<
      typeof import("@/lib/git/clone")
    >("@/lib/git/clone");
    mockCloneGitHubRepository.mockRejectedValue(
      new CloneConflictError(DEST, "someone-else/other")
    );

    const response = await post({ url: "owner/repo" });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe("clone_destination_conflict");
    expect(json.data.existingRemote).toBe("someone-else/other");
    expect(json.data.destination).toBe(DEST);
  });

  it("returns a redacted 500 when git fails", async () => {
    mockCloneGitHubRepository.mockRejectedValue(
      new Error("fatal: git -c http.extraHeader=Authorization: Basic c2VjcmV0 clone")
    );

    const response = await post({ url: "owner/repo" });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).not.toContain("c2VjcmV0");
    expect(json.error).toContain("[redacted]");
  });

  it("audits a first-time clone with no project to attribute it to", async () => {
    // The common case: the repository is cloned before the project exists. This
    // used to write nothing at all, so the audit trail missed nearly every
    // clone it was there to record.
    await post({ url: "owner/repo" });

    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        operation: "clone",
        status: "success",
      })
    );
  });

  it("audits a failed clone too", async () => {
    mockCloneGitHubRepository.mockRejectedValue(new Error("early EOF"));

    await post({ url: "owner/repo" });

    expect(mockLogSyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        operation: "clone",
        status: "failure",
      })
    );
  });
});
