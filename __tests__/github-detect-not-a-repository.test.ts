import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

import {
  git,
  makeBareRepository,
  makeMissingPath,
  makePlainDirectory,
  makeRepository,
  makeRepositoryWithGitHubRemote,
  makeTempRoot,
} from "./helpers/temp-git-repo";

/**
 * Regression pin: a `gitRepoPath` that is not a usable git repository is a
 * configuration state the user can fix, not a server fault.
 *
 * `GitHubConnectBanner` fetches `GET /github/detect` on mount, so this fires
 * on every project page for such a project. The route used to hand git's own
 * `fatal: not a git repository` prose to `errorResponse(...)` — a 500 in the
 * browser console. The near miss is the point: a real repository with no
 * `origin` already answered `200 { detected: false }`, so only the
 * not-a-repository case degraded.
 *
 * Only `@/lib/db` is mocked. `lib/git/remote` runs for real against real
 * temporary directories, because the shape git produces for "this is not a
 * repository" is exactly what the route has to classify — a mocked rejection
 * would pin the handler, not the condition.
 */

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const PROJECT_ID = "proj-detect";

let tmpRoot = "";
/** An ordinary directory that was never `git init`-ed. */
let notARepoPath = "";
/** A path that does not exist at all — a moved or deleted project directory. */
let missingPath = "";
/** A real repository with no remote: the near-miss control, must stay 200. */
let repoWithoutRemotePath = "";
/** A real repository whose origin is a GitHub URL: the success control. */
let repoWithGitHubRemotePath = "";
/**
 * A bare repository with a GitHub origin. Control, green on both sides of the
 * fix: `git remote -v` reads it fine but it is not "inside a work tree", so a
 * guard written on that question alone would newly refuse it.
 */
let bareRepoPath = "";

function seedProject(gitRepoPath: string): void {
  dbMockState.getQueue = [
    {
      id: PROJECT_ID,
      name: "Detect",
      gitRepoPath,
      githubOwnerRepo: null,
      defaultBranch: null,
    },
  ];
}

async function callDetect() {
  const { GET } = await import(
    "@/app/api/projects/[projectId]/github/detect/route"
  );
  return GET(mockNextRequest(), mockRouteContext({ projectId: PROJECT_ID }));
}



beforeAll(() => {
  tmpRoot = makeTempRoot("arij-detect-not-a-repo-");

  notARepoPath = makePlainDirectory(tmpRoot);
  missingPath = makeMissingPath(tmpRoot);
  repoWithoutRemotePath = makeRepository(tmpRoot, "repo-without-remote");
  repoWithGitHubRemotePath = makeRepositoryWithGitHubRemote(
    tmpRoot,
    "repo-with-github-remote",
  );
  bareRepoPath = makeBareRepository(tmpRoot);
});

afterAll(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
});

describe("detectGitHubRemote against an unusable repository path", () => {
  it("rejects with a typed, machine-readable error when the path is not a repository", async () => {
    const { detectGitHubRemote } = await import("@/lib/git/remote");

    await expect(detectGitHubRemote(notARepoPath)).rejects.toMatchObject({
      code: "GIT_REPO_NOT_A_REPOSITORY",
      repoPath: notARepoPath,
    });
  });

  it("rejects with a distinct code when the path does not exist", async () => {
    const { detectGitHubRemote } = await import("@/lib/git/remote");

    await expect(detectGitHubRemote(missingPath)).rejects.toMatchObject({
      code: "GIT_REPO_PATH_MISSING",
      repoPath: missingPath,
    });
  });

  it("still resolves to null for a real repository with no remote", async () => {
    const { detectGitHubRemote } = await import("@/lib/git/remote");

    await expect(detectGitHubRemote(repoWithoutRemotePath)).resolves.toBeNull();
  });

  it("still reads the remote of a bare repository", async () => {
    const { detectGitHubRemote } = await import("@/lib/git/remote");

    await expect(detectGitHubRemote(bareRepoPath)).resolves.toMatchObject({
      ownerRepo: "octocat/hello-world",
    });
  });
});

describe("GET /api/projects/[projectId]/github/detect", () => {
  it("answers 400 with GIT_REPO_NOT_A_REPOSITORY instead of 500", async () => {
    seedProject(notARepoPath);

    const response = await callDetect();
    const body = await response.json();

    expect(response.status).not.toBe(500);
    expect(response.status).toBe(400);
    expect(body.code).toBe("GIT_REPO_NOT_A_REPOSITORY");
    expect(typeof body.error).toBe("string");
    expect(body.error.trim().length).toBeGreaterThan(0);
    // git's own prose is a transport-shaped message the UI cannot act on.
    expect(body.error).not.toMatch(/fatal:/i);
  });

  it("answers 400 with GIT_REPO_PATH_MISSING when the directory is gone", async () => {
    seedProject(missingPath);

    const response = await callDetect();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("GIT_REPO_PATH_MISSING");
  });

  it("audits the refusal in git_sync_log with its code", async () => {
    seedProject(notARepoPath);

    await callDetect();

    const logged = dbMockState.insertCalls as Array<{
      operation?: string;
      status?: string;
      detail?: string | null;
    }>;
    const detectRow = logged.find((row) => row.operation === "detect");

    expect(detectRow).toBeDefined();
    expect(detectRow?.status).toBe("failed");
    expect(detectRow?.detail).toContain("GIT_REPO_NOT_A_REPOSITORY");
  });

  it("still answers 200 { detected: false } for a repository with no remote", async () => {
    seedProject(repoWithoutRemotePath);

    const response = await callDetect();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ detected: false });
  });

  it("still answers 200 for a bare repository", async () => {
    seedProject(bareRepoPath);

    const response = await callDetect();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ detected: true, ownerRepo: "octocat/hello-world" });
  });

  it("still answers 200 with the owner/repo for a GitHub remote", async () => {
    seedProject(repoWithGitHubRemotePath);

    const response = await callDetect();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      detected: true,
      owner: "octocat",
      repo: "hello-world",
      ownerRepo: "octocat/hello-world",
      remoteName: "origin",
    });
  });
});
