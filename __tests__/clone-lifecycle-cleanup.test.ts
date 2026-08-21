import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Story: "As a user deleting a cloned project, I want the option to remove its
 * directory" — the safety guards and the actual removal.
 *
 * These run against real git repositories in a temp directory rather than a
 * mocked `simple-git`: the whole point of the story is that the right
 * directories disappear from disk and the wrong ones do not, and a mock cannot
 * demonstrate either.
 */

// resolveProjectsRoot() reads the settings table; every test passes an explicit
// root, so the database is never touched.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  removeProjectClone,
  resolveRemovableClonePath,
} from "@/lib/projects/clone-cleanup";

let tmpRoot: string;
let projectsRoot: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Arij Test",
      GIT_AUTHOR_EMAIL: "test@arij.local",
      GIT_COMMITTER_NAME: "Arij Test",
      GIT_COMMITTER_EMAIL: "test@arij.local",
    },
  });
}

/** Stamps the marker the clone service writes into repositories it creates. */
function markAsArijClone(repoPath: string, name = "owner/repo"): void {
  const [owner, repo] = name.split("/");
  fs.writeFileSync(
    path.join(repoPath, ".git", "arij-clone.json"),
    JSON.stringify({
      version: 1,
      owner,
      repo,
      ownerRepo: name,
      remoteUrl: `https://github.com/${name}.git`,
      createdAt: new Date().toISOString(),
    })
  );
}

/**
 * A real repository with one commit, at `<projectsRoot>/<name>`.
 *
 * Marked as an Arij clone by default: removal requires proof Arij created the
 * directory, so an unmarked repository is the *user's*, and tests that want one
 * pass `marked: false`.
 */
function makeRepo(
  name: string,
  root = projectsRoot,
  options: { marked?: boolean } = {}
): string {
  const repoPath = path.join(root, name);
  fs.mkdirSync(repoPath, { recursive: true });
  git(repoPath, "init", "--initial-branch=main");
  fs.writeFileSync(path.join(repoPath, "README.md"), "# test\n");
  git(repoPath, "add", ".");
  git(repoPath, "commit", "-m", "initial");
  if (options.marked !== false) markAsArijClone(repoPath);
  return repoPath;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arij-clone-cleanup-"));
  projectsRoot = path.join(tmpRoot, "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveRemovableClonePath", () => {
  it("allows a github-cloned project inside the projects root", () => {
    const repoPath = path.join(projectsRoot, "owner-repo");

    const result = resolveRemovableClonePath(
      { gitRepoPath: repoPath, cloneSource: "github" },
      projectsRoot
    );

    expect(result).toEqual({ ok: true, path: repoPath });
  });

  it("refuses a project whose clone_source is NULL (user-supplied path)", () => {
    const repoPath = path.join(projectsRoot, "owner-repo");

    const result = resolveRemovableClonePath(
      { gitRepoPath: repoPath, cloneSource: null },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "not_managed" });
  });

  it("refuses an unknown clone_source value", () => {
    const result = resolveRemovableClonePath(
      {
        gitRepoPath: path.join(projectsRoot, "owner-repo"),
        cloneSource: "gitlab",
      },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "not_managed" });
  });

  it("refuses a path outside the projects root even when clone_source is github", () => {
    const result = resolveRemovableClonePath(
      { gitRepoPath: path.join(tmpRoot, "elsewhere"), cloneSource: "github" },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "outside_projects_root" });
  });

  it("refuses the projects root itself", () => {
    const result = resolveRemovableClonePath(
      { gitRepoPath: projectsRoot, cloneSource: "github" },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "outside_projects_root" });
  });

  it("refuses a sibling directory that merely shares the root's prefix", () => {
    const result = resolveRemovableClonePath(
      { gitRepoPath: `${projectsRoot}-backup/owner-repo`, cloneSource: "github" },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "outside_projects_root" });
  });

  it("refuses a traversal that climbs back out of the root", () => {
    const result = resolveRemovableClonePath(
      {
        gitRepoPath: path.join(projectsRoot, "..", "..", "etc"),
        cloneSource: "github",
      },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "outside_projects_root" });
  });

  it("refuses a symlink inside the root that points outside it", () => {
    const outside = path.join(tmpRoot, "precious");
    fs.mkdirSync(outside, { recursive: true });
    const link = path.join(projectsRoot, "owner-repo");
    fs.symlinkSync(outside, link, "dir");

    const result = resolveRemovableClonePath(
      { gitRepoPath: link, cloneSource: "github" },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "outside_projects_root" });
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("refuses a project with no repository path", () => {
    const result = resolveRemovableClonePath(
      { gitRepoPath: null, cloneSource: "github" },
      projectsRoot
    );

    expect(result).toEqual({ ok: false, reason: "no_path" });
  });
});

describe("removeProjectClone", () => {
  it("removes the clone directory and its worktrees", async () => {
    const repoPath = makeRepo("owner-repo");

    // Mirror what createWorktree() does: worktrees live in a shared
    // `.arij-worktrees` directory next to the clone.
    const worktreeBase = path.join(projectsRoot, ".arij-worktrees");
    fs.mkdirSync(worktreeBase, { recursive: true });
    const worktreePath = path.join(worktreeBase, "feature-epic-abc-demo");
    git(repoPath, "worktree", "add", "-b", "feature/epic-abc-demo", worktreePath, "main");
    expect(fs.existsSync(worktreePath)).toBe(true);

    const result = await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: "github" },
      { projectsRoot }
    );

    expect(result.removed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.worktreesRemoved).toEqual([worktreePath]);
    expect(fs.existsSync(repoPath)).toBe(false);
    expect(fs.existsSync(worktreePath)).toBe(false);
    // The shared worktree directory belongs to every clone under the root and
    // must survive the removal of one of them.
    expect(fs.existsSync(worktreeBase)).toBe(true);
  });

  it("leaves other clones' worktrees alone", async () => {
    const repoPath = makeRepo("owner-repo");
    const otherRepo = makeRepo("owner-other");

    const worktreeBase = path.join(projectsRoot, ".arij-worktrees");
    fs.mkdirSync(worktreeBase, { recursive: true });

    const mine = path.join(worktreeBase, "feature-mine");
    git(repoPath, "worktree", "add", "-b", "feature/mine", mine, "main");
    const theirs = path.join(worktreeBase, "feature-theirs");
    git(otherRepo, "worktree", "add", "-b", "feature/theirs", theirs, "main");

    await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: "github" },
      { projectsRoot }
    );

    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.existsSync(theirs)).toBe(true);
    expect(fs.existsSync(otherRepo)).toBe(true);
  });

  it("prunes stale worktree records before removing", async () => {
    const repoPath = makeRepo("owner-repo");
    const worktreeBase = path.join(projectsRoot, ".arij-worktrees");
    fs.mkdirSync(worktreeBase, { recursive: true });
    const worktreePath = path.join(worktreeBase, "feature-gone");
    git(repoPath, "worktree", "add", "-b", "feature/gone", worktreePath, "main");
    // Simulate a crashed agent: the directory is gone, git's record is not.
    fs.rmSync(worktreePath, { recursive: true, force: true });

    const result = await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: "github" },
      { projectsRoot }
    );

    expect(result.removed).toBe(true);
    expect(result.worktreesPruned).toBe(1);
    expect(fs.existsSync(repoPath)).toBe(false);
  });

  it("never touches a user-supplied directory", async () => {
    const repoPath = makeRepo("owner-repo");

    const result = await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: null },
      { projectsRoot }
    );

    expect(result.removed).toBe(false);
    expect(result.reason).toBe("not_managed");
    expect(result.message).toMatch(/supplied by you/i);
    expect(fs.existsSync(repoPath)).toBe(true);
  });

  it("never touches a directory outside the projects root", async () => {
    const outsideRoot = path.join(tmpRoot, "elsewhere");
    fs.mkdirSync(outsideRoot, { recursive: true });
    const repoPath = makeRepo("owner-repo", outsideRoot);

    const result = await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: "github" },
      { projectsRoot }
    );

    expect(result.removed).toBe(false);
    expect(result.reason).toBe("outside_projects_root");
    expect(fs.existsSync(repoPath)).toBe(true);
  });

  it("reports a directory that is already gone", async () => {
    const result = await removeProjectClone(
      {
        gitRepoPath: path.join(projectsRoot, "owner-vanished"),
        cloneSource: "github",
      },
      { projectsRoot }
    );

    expect(result.removed).toBe(false);
    expect(result.reason).toBe("missing");
  });

  it("removes a clone whose git metadata is broken", async () => {
    // An interrupted clone can leave a directory git no longer understands;
    // cleanup must still be able to delete it — the marker, not git, is what
    // proves it is ours.
    const repoPath = path.join(projectsRoot, "owner-broken");
    fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoPath, "leftover.bin"), "partial");
    markAsArijClone(repoPath, "owner/broken");

    const result = await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: "github" },
      { projectsRoot }
    );

    expect(result.removed).toBe(true);
    expect(fs.existsSync(repoPath)).toBe(false);
  });

  it("never touches a directory carrying no Arij clone marker", async () => {
    // `clone_source` is a database column and every column is reachable from
    // the API, so a row claiming "github" is a request, not evidence. Without
    // the marker the directory is somebody's own checkout that happens to sit
    // under the projects root.
    const repoPath = makeRepo("owner-repo", projectsRoot, { marked: false });

    const result = await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: "github" },
      { projectsRoot }
    );

    expect(result.removed).toBe(false);
    expect(result.reason).toBe("not_arij_clone");
    expect(result.message).toMatch(/no Arij clone marker/i);
    expect(fs.existsSync(repoPath)).toBe(true);
  });

  it("leaves a worktree registered outside .arij-worktrees alone", async () => {
    // Being registered to this clone is not a licence to delete: a worktree the
    // user added by hand elsewhere is their working directory, and may hold
    // work that exists nowhere else.
    const repoPath = makeRepo("owner-repo");

    const handMade = path.join(projectsRoot, "my-own-checkout");
    git(repoPath, "worktree", "add", "-b", "feature/by-hand", handMade, "main");
    fs.writeFileSync(path.join(handMade, "uncommitted.txt"), "precious\n");

    const result = await removeProjectClone(
      { gitRepoPath: repoPath, cloneSource: "github" },
      { projectsRoot }
    );

    expect(result.removed).toBe(true);
    expect(result.worktreesRemoved).toEqual([]);
    expect(fs.existsSync(handMade)).toBe(true);
    expect(fs.readFileSync(path.join(handMade, "uncommitted.txt"), "utf-8")).toBe(
      "precious\n"
    );
  });
});
