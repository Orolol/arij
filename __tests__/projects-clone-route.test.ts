import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  mockJsonRequest,
  resetDbMockState,
} from "@/__tests__/helpers/db-mock";

const mockCloneRepository = vi.hoisted(() => vi.fn());
const mockGetToken = vi.hoisted(() => vi.fn());
const mockValidateToken = vi.hoisted(() => vi.fn());
const mockEnsureProjectsRoot = vi.hoisted(() => vi.fn(() => "/workspace/projects"));
const mockCloneDestination = vi.hoisted(() =>
  vi.fn((owner: string, repo: string, root: string) => `${root}/${owner}-${repo}`)
);

// Real drizzle + real schema: writeGitSyncLog runs for real against the chain
// mock, so the audit row it builds is what the assertions inspect.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

// Only the clone itself is faked — CloneError and redactGitError stay real so
// the status mapping and the redaction are exercised end to end.
vi.mock("@/lib/git/clone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/git/clone")>()),
  cloneRepository: mockCloneRepository,
}));

vi.mock("@/lib/github/client", () => ({
  getGitHubTokenFromSettings: mockGetToken,
  validateGitHubToken: mockValidateToken,
}));

vi.mock("@/lib/projects/workspace", () => ({
  ensureProjectsRoot: mockEnsureProjectsRoot,
  cloneDestination: mockCloneDestination,
  resolveProjectsRoot: vi.fn(() => "/workspace/projects"),
}));

vi.mock("@/lib/utils/nanoid", () => ({ createId: vi.fn(() => "log-1") }));

import { POST } from "@/app/api/projects/clone/route";
import { CloneError } from "@/lib/git/clone";
import { DEFAULT_CLONE_TIMEOUT_MS } from "@/lib/git/clone-constants";

const PAT = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";

function cloneRequest(body: Record<string, unknown>) {
  return mockJsonRequest(body, { url: "http://localhost:3000/api/projects/clone" });
}

function syncLogRows() {
  return dbMockState.insertCalls as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
  mockGetToken.mockReturnValue(null);
  mockValidateToken.mockResolvedValue({ valid: true, login: "octocat", status: 200 });
  mockEnsureProjectsRoot.mockReturnValue("/workspace/projects");
  mockCloneDestination.mockImplementation(
    (owner: string, repo: string, root: string) => `${root}/${owner}-${repo}`
  );
  mockCloneRepository.mockResolvedValue({
    path: "/workspace/projects/octocat-hello-world",
    defaultBranch: "main",
    reused: false,
    durationMs: 1234,
  });
});

describe("POST /api/projects/clone — success", () => {
  it("returns 201 with the clone metadata", async () => {
    const response = await POST(cloneRequest({ url: "https://github.com/octocat/hello-world" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      path: "/workspace/projects/octocat-hello-world",
      ownerRepo: "octocat/hello-world",
      remoteUrl: "https://github.com/octocat/hello-world.git",
      defaultBranch: "main",
      reused: false,
    });
  });

  it("clones into <projects_root>/<owner>-<repo> from the clean URL", async () => {
    await POST(cloneRequest({ url: "https://github.com/octocat/hello-world" }));

    expect(mockCloneDestination).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      "/workspace/projects"
    );
    expect(mockCloneRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        cloneUrl: "https://github.com/octocat/hello-world.git",
        dest: "/workspace/projects/octocat-hello-world",
        expectedOwnerRepo: "octocat/hello-world",
        branch: null,
        timeoutMs: DEFAULT_CLONE_TIMEOUT_MS,
      })
    );
  });

  it.each([
    ["git@github.com:octocat/hello-world.git"],
    ["octocat/hello-world"],
    ["https://github.com/octocat/hello-world/tree/main"],
    ["https://github.com/octocat/hello-world.git"],
    ["https://www.github.com/octocat/hello-world?tab=readme-ov-file"],
  ])("accepts %s", async (url) => {
    const response = await POST(cloneRequest({ url }));

    expect(response.status).toBe(201);
    expect(mockCloneRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        cloneUrl: "https://github.com/octocat/hello-world.git",
      })
    );
  });

  it("passes an explicit branch through to the clone", async () => {
    mockCloneRepository.mockResolvedValue({
      path: "/workspace/projects/octocat-hello-world",
      defaultBranch: "develop",
      reused: false,
      durationMs: 10,
    });

    const response = await POST(
      cloneRequest({ url: "octocat/hello-world", branch: "develop" })
    );
    const body = await response.json();

    expect(mockCloneRepository).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "develop" })
    );
    expect(body.data.defaultBranch).toBe("develop");
  });

  it("returns 200 when an existing clone was reused", async () => {
    mockCloneRepository.mockResolvedValue({
      path: "/workspace/projects/octocat-hello-world",
      defaultBranch: "main",
      reused: true,
      durationMs: 42,
    });

    const response = await POST(cloneRequest({ url: "octocat/hello-world" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.reused).toBe(true);
  });

  it("uses the configured clone timeout when one is set", async () => {
    dbMockState.getQueue.push({ key: "clone_timeout_ms", value: "60000" });

    await POST(cloneRequest({ url: "octocat/hello-world" }));

    expect(mockCloneRepository).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 60000 })
    );
  });

  it("records a git_sync_log row with operation 'clone'", async () => {
    await POST(cloneRequest({ url: "octocat/hello-world" }));

    expect(syncLogRows()).toHaveLength(1);
    expect(syncLogRows()[0]).toMatchObject({
      operation: "clone",
      status: "success",
      projectId: null,
      branch: "main",
    });
    // The clone runs before any project row exists, so the audit row cannot
    // reference one (migration 0028_git_sync_log_nullable_project).
    const detail = JSON.parse(syncLogRows()[0].detail as string);
    expect(detail).toMatchObject({
      ownerRepo: "octocat/hello-world",
      path: "/workspace/projects/octocat-hello-world",
      reused: false,
      durationMs: 1234,
    });
  });
});

describe("POST /api/projects/clone — credentials", () => {
  it("passes the stored PAT to the clone", async () => {
    mockGetToken.mockReturnValue(PAT);

    await POST(cloneRequest({ url: "octocat/hello-world" }));

    expect(mockCloneRepository).toHaveBeenCalledWith(
      expect.objectContaining({ token: PAT })
    );
  });

  it("clones public repos with no token at all", async () => {
    await POST(cloneRequest({ url: "octocat/hello-world" }));

    expect(mockCloneRepository).toHaveBeenCalledWith(
      expect.objectContaining({ token: null })
    );
  });

  it("returns 401 when GitHub turns out to have rejected the stored PAT", async () => {
    // git cannot tell "you may not see this repo" from "your token is junk":
    // both come back as `Repository not found`. The API can.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetToken.mockReturnValue(PAT);
    mockValidateToken.mockResolvedValue({
      valid: false,
      status: 401,
      error: "GitHub rejected the token. Verify it and try again.",
    });
    mockCloneRepository.mockRejectedValue(
      new CloneError("not_found", "Repository not found: acme/private.")
    );

    const response = await POST(cloneRequest({ url: "acme/private" }));
    const body = await response.json();

    expect(mockValidateToken).toHaveBeenCalledWith(PAT);
    expect(response.status).toBe(401);
    expect(body.code).toBe("auth_failed");
    expect(body.error).toContain("Settings → GitHub PAT");
    consoleError.mockRestore();
  });

  it("keeps the 404 when the PAT is valid but simply has no access", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetToken.mockReturnValue(PAT);
    mockCloneRepository.mockRejectedValue(
      new CloneError(
        "not_found",
        "Repository not found: acme/private. It does not exist, or the GitHub PAT in Settings does not grant access to it."
      )
    );

    const response = await POST(cloneRequest({ url: "acme/private" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain("does not grant access");
    consoleError.mockRestore();
  });

  it("keeps the 404 when GitHub itself cannot be reached", async () => {
    // An unreachable API must not turn a working PAT into a bogus 401.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetToken.mockReturnValue(PAT);
    mockValidateToken.mockResolvedValue({
      valid: false,
      error: "Could not reach GitHub to validate this token.",
    });
    mockCloneRepository.mockRejectedValue(
      new CloneError("not_found", "Repository not found: acme/private.")
    );

    const response = await POST(cloneRequest({ url: "acme/private" }));

    expect(response.status).toBe(404);
    consoleError.mockRestore();
  });

  it("does not call GitHub at all when no PAT is configured", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCloneRepository.mockRejectedValue(
      new CloneError("not_found", "Repository not found: acme/private.")
    );

    const response = await POST(cloneRequest({ url: "acme/private" }));

    expect(response.status).toBe(404);
    expect(mockValidateToken).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("never leaks the PAT into the response, the log row or the console", async () => {
    mockGetToken.mockReturnValue(PAT);
    const basic = Buffer.from(`x-access-token:${PAT}`).toString("base64");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCloneRepository.mockRejectedValue(
      new Error(
        `fatal: unable to access 'https://x-access-token:${PAT}@github.com/acme/private.git/'\n` +
          `while running: git -c http.extraHeader=Authorization: Basic ${basic} clone`
      )
    );

    const response = await POST(cloneRequest({ url: "acme/private" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(PAT);
    expect(JSON.stringify(body)).not.toContain(basic);
    expect(JSON.stringify(syncLogRows())).not.toContain(PAT);
    expect(JSON.stringify(syncLogRows())).not.toContain(basic);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(PAT);
    consoleError.mockRestore();
  });
});

describe("POST /api/projects/clone — invalid input", () => {
  it.each([
    ["not a url"],
    ["https://gitlab.com/octocat/hello-world.git"],
    ["https://github.com/octocat"],
    ["https://github.com/../../etc/passwd"],
    ["../../etc/passwd"],
    ["octocat/.."],
  ])("rejects %s with 400", async (url) => {
    const response = await POST(cloneRequest({ url }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(mockCloneRepository).not.toHaveBeenCalled();
  });

  it("rejects a missing url with 400", async () => {
    const response = await POST(cloneRequest({}));

    expect(response.status).toBe(400);
    expect(mockCloneRepository).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/clone — failures", () => {
  const cases: Array<[string, ConstructorParameters<typeof CloneError>[0], number]> = [
    ["missing repository", "not_found", 404],
    ["bad credentials", "auth_failed", 401],
    ["unreachable host", "network", 502],
    ["unknown branch", "branch_not_found", 400],
    ["occupied destination", "conflict", 409],
    ["slow clone", "timeout", 504],
    ["anything else", "clone_failed", 500],
  ];

  it.each(cases)("maps %s to HTTP %s", async (_label, code, status) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCloneRepository.mockRejectedValue(new CloneError(code, `boom: ${code}`));

    const response = await POST(cloneRequest({ url: "octocat/hello-world" }));
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toEqual({ error: `boom: ${code}`, code });
    consoleError.mockRestore();
  });

  it("logs the failure to git_sync_log with the reason", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCloneRepository.mockRejectedValue(
      new CloneError("conflict", "/workspace/projects/octocat-hello-world is in the way.")
    );

    await POST(cloneRequest({ url: "octocat/hello-world" }));

    expect(syncLogRows()).toHaveLength(1);
    expect(syncLogRows()[0]).toMatchObject({
      operation: "clone",
      status: "failure",
      projectId: null,
    });
    const detail = JSON.parse(syncLogRows()[0].detail as string);
    expect(detail).toMatchObject({
      ownerRepo: "octocat/hello-world",
      code: "conflict",
      error: "/workspace/projects/octocat-hello-world is in the way.",
    });
    expect(detail.durationMs).toBeGreaterThanOrEqual(0);
    consoleError.mockRestore();
  });

  it("returns 500 and audits the failure when the workspace root cannot be prepared", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEnsureProjectsRoot.mockImplementation(() => {
      throw new Error("EACCES: permission denied, mkdir '/workspace/projects'");
    });

    const response = await POST(cloneRequest({ url: "octocat/hello-world" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("EACCES");
    expect(body.code).toBe("workspace_unavailable");
    expect(mockCloneRepository).not.toHaveBeenCalled();

    // Setup failures are audited like every other one — the attempt happened.
    expect(syncLogRows()).toHaveLength(1);
    expect(syncLogRows()[0]).toMatchObject({ operation: "clone", status: "failure" });
    expect(JSON.parse(syncLogRows()[0].detail as string)).toMatchObject({
      ownerRepo: "octocat/hello-world",
      code: "workspace_unavailable",
    });
    consoleError.mockRestore();
  });

  it("keeps a failing settings read inside the sanitized boundary", async () => {
    // The PAT lookup hits the database too; an error there must not escape as
    // an unstructured framework 500.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetToken.mockImplementation(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });

    const response = await POST(cloneRequest({ url: "octocat/hello-world" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("workspace_unavailable");
    expect(body.error).toContain("SQLITE_BUSY");
    expect(mockCloneRepository).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
