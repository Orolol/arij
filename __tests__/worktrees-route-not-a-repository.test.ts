import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
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
  makeTempRoot,
} from "./helpers/temp-git-repo";

/**
 * Regression pin: a `gitRepoPath` that is not a usable git repository is a
 * configuration state the user can fix, not a server fault — on the worktrees
 * route too.
 *
 * The Git Sync page mounts a worktrees panel, so `GET /worktrees` fires on
 * every load. For a project whose path was never `git init`-ed the route used
 * to hand git's own `fatal: not a git repository (or any parent up to mount
 * point /)` prose to `errorResponse(...)`: a console 500 next to the three
 * `git/*` routes that answer 400 for the very same condition. Strictly milder
 * than those were — the `{ error }` envelope was already there — so only the
 * status and the machine-readable `code` were missing.
 *
 * The near miss is the point: a real repository, with or without agent
 * worktrees, already answered 200, so only the not-a-repository case degraded.
 *
 * Only `@/lib/db` is mocked. `lib/git/remote` and `lib/git/worktrees` run for
 * real against real temporary repositories, because the shape git produces for
 * "this is not a repository" is exactly what the route has to classify — a
 * mocked rejection would pin the handler, not the condition.
 */

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const PROJECT_ID = "proj-worktrees";

let tmpRoot = "";
/** An ordinary directory that was never `git init`-ed. */
let notARepoPath = "";
/** A path that does not exist at all — a moved or deleted project directory. */
let missingPath = "";
/** A real repository with no agent worktree: the near-miss control. */
let repoPath = "";
/** A real repository carrying one agent worktree: the payload control. */
let repoWithWorktreePath = "";
/**
 * A bare repository. Control, green on both sides of the fix: it is not
 * "inside a work tree", so a guard written on that question alone would newly
 * refuse a shape git itself handles.
 */
let bareRepoPath = "";

function seedProject(gitRepoPath: string): void {
  dbMockState.getQueue = [
    {
      id: PROJECT_ID,
      name: "Worktrees",
      gitRepoPath,
      githubOwnerRepo: null,
      defaultBranch: null,
    },
  ];
}

async function callList() {
  const { GET } = await import(
    "@/app/api/projects/[projectId]/worktrees/route"
  );
  return GET(mockNextRequest(), mockRouteContext({ projectId: PROJECT_ID }));
}

async function callPrune() {
  const { POST } = await import(
    "@/app/api/projects/[projectId]/worktrees/route"
  );
  return POST(
    mockNextRequest({ method: "POST" }),
    mockRouteContext({ projectId: PROJECT_ID })
  );
}

beforeAll(() => {
  tmpRoot = makeTempRoot("arij-worktrees-route-");

  // Throws rather than handing out a negative fixture that is inside some
  // checkout, where every "not a repository" assertion would pass vacuously.
  notARepoPath = makePlainDirectory(tmpRoot);
  missingPath = makeMissingPath(tmpRoot);

  repoPath = makeRepository(tmpRoot, "repo-without-worktree");

  repoWithWorktreePath = makeRepository(tmpRoot, "repo-with-worktree");
  git(
    repoWithWorktreePath,
    "worktree",
    "add",
    "-b",
    "feature/epic-1-payments",
    path.join(tmpRoot, ".arij-worktrees", "feature-epic-1-payments"),
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

describe("GET /api/projects/[projectId]/worktrees", () => {
  it("answers 400 with GIT_REPO_NOT_A_REPOSITORY instead of 500", async () => {
    seedProject(notARepoPath);

    const response = await callList();
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

    const response = await callList();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("GIT_REPO_PATH_MISSING");
  });

  it("still answers 200 for a real repository with no agent worktree", async () => {
    seedProject(repoPath);

    const response = await callList();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ worktrees: [], count: 0, orphanCount: 0 });
  });

  it("still lists a real agent worktree", async () => {
    seedProject(repoWithWorktreePath);

    const response = await callList();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.count).toBe(1);
    expect(body.data.worktrees[0]).toMatchObject({
      branch: "feature/epic-1-payments",
      state: "idle",
    });
  });

  it("still answers 200 for a bare repository", async () => {
    seedProject(bareRepoPath);

    const response = await callList();

    expect(response.status).toBe(200);
  });
});

describe("POST /api/projects/[projectId]/worktrees", () => {
  it("answers 400 with GIT_REPO_NOT_A_REPOSITORY instead of 500", async () => {
    seedProject(notARepoPath);

    const response = await callPrune();
    const body = await response.json();

    expect(response.status).not.toBe(500);
    expect(response.status).toBe(400);
    expect(body.code).toBe("GIT_REPO_NOT_A_REPOSITORY");
    expect(body.error).not.toMatch(/fatal:/i);
  });

  it("answers 400 with GIT_REPO_PATH_MISSING when the directory is gone", async () => {
    seedProject(missingPath);

    const response = await callPrune();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("GIT_REPO_PATH_MISSING");
  });

  it("still prunes nothing and answers 200 for a real repository", async () => {
    seedProject(repoPath);

    const response = await callPrune();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      pruned: 0,
      worktrees: [],
      count: 0,
      orphanCount: 0,
    });
  });
});
