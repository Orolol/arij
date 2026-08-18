/**
 * The `/projects` .gitignore rule: cloned repositories — and the worktrees
 * Arij creates for them — must never show up in Arij's own git history when
 * dogfooding the app on its own checkout.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECTS_DIRNAME } from "@/lib/projects/workspace-constants";

const REPO_ROOT = process.cwd();
const CLONE_DIRNAME = "owner-repo";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" });
}

/** `git check-ignore -v <p>`; null when the path is not ignored (exit 1). */
function checkIgnore(relativePath: string): string | null {
  try {
    return git(["check-ignore", "-v", "--no-index", relativePath]).trim();
  } catch {
    return null;
  }
}

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

/** Materializes `<repo>/projects/...` and returns the absolute root path. */
function materialize(...segments: string[]): string {
  const root = path.join(REPO_ROOT, DEFAULT_PROJECTS_DIRNAME);
  const alreadyThere = fs.existsSync(root);
  const target = path.join(root, ...segments);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "README.md"), "# clone\n");
  // Only remove the root if this test created it.
  if (!alreadyThere) created.push(root);
  return root;
}

/** Working-tree entries under the root `projects/` directory, if any. */
function statusUnderProjectsRoot(): string[] {
  return git(["status", "--porcelain"])
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((entry) =>
      entry === `${DEFAULT_PROJECTS_DIRNAME}/` ||
      entry.startsWith(`${DEFAULT_PROJECTS_DIRNAME}/`)
    );
}

describe(".gitignore — app-managed clone root", () => {
  it("contains the anchored /projects rule", () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf-8");

    expect(gitignore.split("\n").map((l) => l.trim())).toContain("/projects");
  });

  it("ignores a clone destination", () => {
    expect(checkIgnore(`${DEFAULT_PROJECTS_DIRNAME}/${CLONE_DIRNAME}`)).toContain(
      "/projects"
    );
  });

  it("ignores the worktrees created for a cloned project", () => {
    // lib/git/manager.ts places worktrees at path.join(repoPath, "..",
    // ".arij-worktrees") — for a clone at <root>/<owner>-<repo> that is
    // <root>/.arij-worktrees, covered by the same rule.
    const clonePath = path.join(
      REPO_ROOT,
      DEFAULT_PROJECTS_DIRNAME,
      CLONE_DIRNAME
    );
    const worktreeBase = path.join(clonePath, "..", ".arij-worktrees");

    expect(path.resolve(worktreeBase)).toBe(
      path.join(REPO_ROOT, DEFAULT_PROJECTS_DIRNAME, ".arij-worktrees")
    );
    expect(
      checkIgnore(path.relative(REPO_ROOT, path.join(worktreeBase, "epic-branch")))
    ).toContain("/projects");
  });

  it("leaves app/projects and lib/projects tracked (the rule is anchored)", () => {
    expect(checkIgnore("app/projects")).toBeNull();
    expect(checkIgnore("lib/projects")).toBeNull();
    expect(checkIgnore("lib/projects/workspace.ts")).toBeNull();
  });

  it("keeps git status clean after a clone lands in the default root", () => {
    materialize(CLONE_DIRNAME);

    expect(statusUnderProjectsRoot()).toEqual([]);
  });

  it("keeps git status clean after an epic build adds a worktree", () => {
    materialize(CLONE_DIRNAME);
    materialize(".arij-worktrees", "feature-epic-abc123");

    expect(statusUnderProjectsRoot()).toEqual([]);
  });
});
