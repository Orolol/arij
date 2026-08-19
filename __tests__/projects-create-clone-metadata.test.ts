import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
} from "@/__tests__/helpers/db-mock";
import { createProjectSchema } from "@/lib/validation/schemas";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const pathState = vi.hoisted(() => ({
  result: { valid: true, normalizedPath: "/normalized/path" } as
    | { valid: true; normalizedPath: string }
    | { valid: false; error: string },
}));

vi.mock("@/lib/validation/path", () => ({
  validatePath: vi.fn(async () => pathState.result),
}));

// The real module is pure except `detectGitHubRemote`, which shells out to
// git — override just that so the origin check is a plain stub.
vi.mock("@/lib/git/remote", async () => {
  const actual = await import("@/lib/git/remote");
  return {
    ...actual,
    detectGitHubRemote: vi.fn(),
  };
});

const MATCHING_ORIGIN = {
  owner: "Orolol",
  repo: "arij",
  ownerRepo: "Orolol/arij",
  remoteName: "origin",
  remoteUrl: "https://github.com/Orolol/arij.git",
};

const BASE = { name: "Arij", description: "Orchestrator" };

describe("createProjectSchema", () => {
  it("accepts the clone metadata fields as optional", () => {
    const parsed = createProjectSchema.safeParse({
      ...BASE,
      gitRepoPath: "/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      defaultBranch: "main",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.cloneSource).toBe("github");
    expect(parsed.success && parsed.data.defaultBranch).toBe("main");
  });

  it("still accepts a payload with none of them", () => {
    expect(createProjectSchema.safeParse(BASE).success).toBe(true);
  });

  it("rejects a clone source Arij cannot have produced", () => {
    const parsed = createProjectSchema.safeParse({
      ...BASE,
      cloneSource: "gitlab",
    });
    expect(parsed.success).toBe(false);
  });

  it("bounds the remote url and default branch", () => {
    expect(
      createProjectSchema.safeParse({ ...BASE, gitRemoteUrl: "x".repeat(1001) })
        .success
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...BASE, defaultBranch: "x".repeat(256) })
        .success
    ).toBe(false);
  });
});

describe("POST /api/projects", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDbMockState();
    pathState.result = { valid: true, normalizedPath: "/normalized/path" };

    // Default: the directory is the claimed clone, so happy-path payloads
    // pass the provenance check.
    const { detectGitHubRemote } = await import("@/lib/git/remote");
    vi.mocked(detectGitHubRemote).mockResolvedValue(MATCHING_ORIGIN);
  });

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/projects/route");
    return POST(mockJsonRequest(body));
  }

  it("stores the normalised absolute path, not the raw input", async () => {
    pathState.result = {
      valid: true,
      normalizedPath: "/home/user/arij/projects/Orolol-arij",
    };
    dbMockState.getQueue = [{ id: "proj-1" }];

    const res = await post({ ...BASE, gitRepoPath: "  ./projects/Orolol-arij  " });

    expect(res.status).toBe(201);
    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      })
    );
  });

  it("persists the GitHub clone metadata so the project is connected on arrival", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      defaultBranch: "main",
    });

    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        githubOwnerRepo: "Orolol/arij",
        cloneSource: "github",
        gitRemoteUrl: "https://github.com/Orolol/arij.git",
        defaultBranch: "main",
      })
    );
  });

  it("leaves every clone column NULL for a user-supplied path", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    await post({ ...BASE, gitRepoPath: "/local/repo" });

    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        githubOwnerRepo: null,
        cloneSource: null,
        gitRemoteUrl: null,
        defaultBranch: null,
      })
    );
  });

  it("keeps gitRepoPath null when no path was supplied", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    await post(BASE);

    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({ gitRepoPath: null })
    );
  });

  it("rejects an unusable path with the validator's message", async () => {
    pathState.result = {
      valid: false,
      error: "Path does not exist or is not accessible",
    };

    const res = await post({ ...BASE, gitRepoPath: "/nope" });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Path does not exist or is not accessible");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("rejects a cloneSource without the full provenance tuple", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      cloneSource: "github",
      // gitRemoteUrl and defaultBranch missing
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("cloneSource requires");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("rejects a cloneSource with no gitRepoPath at all", async () => {
    const res = await post({
      ...BASE,
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      cloneSource: "github",
      defaultBranch: "main",
    });

    expect(res.status).toBe(400);
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("rejects clone metadata whose remote URL names a different repository", async () => {
    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://github.com/evil/totally-different.git",
      cloneSource: "github",
      defaultBranch: "main",
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("does not describe the claimed GitHub repository");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("rejects a credential-bearing remote URL as a clean clone URL", async () => {
    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://x-access-token:sekrit@github.com/Orolol/arij.git",
      cloneSource: "github",
      defaultBranch: "main",
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("not a parseable clean GitHub remote URL");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("rejects a credential-bearing gitRemoteUrl even without cloneSource", async () => {
    // git_remote_url is a clean-URL column (rendered in the UI and later
    // re-cloned from): a credential-bearing URL must not be persisted on a
    // manual project either, not only on the cloneSource path.
    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/repo",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://x-access-token:sekrit@github.com/Orolol/arij.git",
      defaultBranch: "main",
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("not a parseable clean GitHub remote URL");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("rejects a non-GitHub gitRemoteUrl even without cloneSource", async () => {
    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/repo",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://gitlab.com/Orolol/arij.git",
      defaultBranch: "main",
    });

    expect(res.status).toBe(400);
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("stores a clean gitRemoteUrl without cloneSource", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/repo",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      defaultBranch: "develop",
    });

    expect(res.status).toBe(201);
    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        gitRemoteUrl: "https://github.com/Orolol/arij.git",
        defaultBranch: "develop",
        // No cloneSource: the provenance (origin) check stays skipped — the
        // directory is user-supplied, only the URL grammar is enforced.
        cloneSource: null,
      })
    );
  });

  it("rejects cloneSource when the directory is not a clone of the claimed repo", async () => {
    const { detectGitHubRemote } = await import("@/lib/git/remote");
    vi.mocked(detectGitHubRemote).mockResolvedValue({
      owner: "someone-else",
      repo: "unrelated",
      ownerRepo: "someone-else/unrelated",
      remoteName: "origin",
      remoteUrl: "https://github.com/someone-else/unrelated.git",
    });

    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      cloneSource: "github",
      defaultBranch: "main",
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("not a clone of the claimed GitHub repository");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("rejects cloneSource when the directory is not a GitHub clone at all", async () => {
    const { detectGitHubRemote } = await import("@/lib/git/remote");
    vi.mocked(detectGitHubRemote).mockResolvedValue(null);

    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      cloneSource: "github",
      defaultBranch: "main",
    });

    expect(res.status).toBe(400);
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("returns 400, not 500, when the directory is not a git repository at all", async () => {
    // A plain directory makes simple-git's getRemotes() reject
    // ("fatal: not a git repository"). That is not an internal error: the
    // directory is provably not a clone, so the claim is rejected with the
    // same 400 as any other failed provenance check.
    const { detectGitHubRemote } = await import("@/lib/git/remote");
    vi.mocked(detectGitHubRemote).mockRejectedValue(
      new Error("fatal: not a git repository")
    );

    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/plain-directory",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      cloneSource: "github",
      defaultBranch: "main",
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("not a clone of the claimed GitHub repository");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("compares the claimed owner/repo case-insensitively", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];
    const { detectGitHubRemote } = await import("@/lib/git/remote");
    vi.mocked(detectGitHubRemote).mockResolvedValue(MATCHING_ORIGIN);

    const res = await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "orolol/arij",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      cloneSource: "github",
      defaultBranch: "main",
    });

    expect(res.status).toBe(201);
    expect(dbMockState.insertCalls).toHaveLength(1);
  });
});
