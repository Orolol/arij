/**
 * Temporary git repositories for the route tests that need real `git`
 * behaviour rather than a mocked `simple-git`.
 *
 * WHY ONE COPY. Three "not a repository" suites and the route-status
 * convention pinned their own `initRepo`/`git init` helpers, each with its own
 * comment explaining the same two traps. A fixture that gets this wrong does
 * not fail — it passes vacuously, which is the expensive kind of wrong:
 *
 *  1. A directory that is not `git init`-ed is only a usable negative fixture
 *     if it sits OUTSIDE every repository. A temp dir created under a checkout
 *     is `--is-inside-work-tree`-true, and every "not a repository" assertion
 *     against it goes green for the wrong reason. `assertNotInsideRepository`
 *     refuses to hand one out.
 *  2. A repository needs a commit before `git worktree add` has anything to
 *     branch from, and before `git remote -v`/`git status` produce the output
 *     a real project produces.
 *
 * The commit is written with explicit `-c user.email/-c user.name` rather than
 * relying on the developer's git config, so the fixture does not depend on
 * whoever runs the suite.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Run git in `cwd`, throwing on failure. Pinned to a pipe, never a TTY. */
export function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Run git and return its stdout, for the fixtures that inspect it. */
export function gitOutput(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
}

/** A fresh temp directory to hold one test file's fixtures. */
export function makeTempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Throws when `dir` is inside a git repository.
 *
 * The negative fixture is worthless when this holds, and it is the failure
 * mode that reads as a passing test: `git rev-parse` answers YES and every
 * "not a repository" assertion succeeds for a reason the test does not name.
 */
export function assertNotInsideRepository(dir: string): void {
  let inside = true;
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      stdio: "pipe",
    });
  } catch {
    inside = false;
  }
  if (inside) {
    throw new Error(
      `${dir} is inside a git repository, so it cannot serve as a ` +
        `"not a repository" fixture — the assertions against it would pass ` +
        `for the wrong reason. Create the temp root outside any checkout.`,
    );
  }
}

/** A directory that exists and is NOT a repository. */
export function makePlainDirectory(root: string, name = "plain-directory"): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  assertNotInsideRepository(dir);
  return dir;
}

/** A repository with one commit on its default branch. */
export function makeRepository(root: string, name = "repo"): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init");
  fs.writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  git(dir, "add", "README.md");
  git(
    dir,
    "-c",
    "user.email=fixture@arij.local",
    "-c",
    "user.name=Arij Fixture",
    "commit",
    "-m",
    "initial",
  );
  return dir;
}

/** A repository whose `origin` is a GitHub URL. */
export function makeRepositoryWithGitHubRemote(
  root: string,
  name = "repo-with-github-remote",
  remote = "https://github.com/octocat/hello-world.git",
): string {
  const dir = makeRepository(root, name);
  git(dir, "remote", "add", "origin", remote);
  return dir;
}

/**
 * A BARE repository with a GitHub origin.
 *
 * The control that matters for every "is this a usable repository?" guard:
 * `git remote -v` reads it fine while `--is-inside-work-tree` is false, so a
 * guard written on that one question alone refuses a shape git handles.
 */
export function makeBareRepository(
  root: string,
  name = "bare-repo",
  remote = "https://github.com/octocat/hello-world.git",
): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "--bare");
  // A bare repository with NO remote is a legitimate fixture (a push target),
  // so an empty string means "do not add one".
  if (remote) git(dir, "remote", "add", "origin", remote);
  return dir;
}

/** A path that does not exist — a moved or deleted project directory. */
export function makeMissingPath(root: string, name = "was-moved-away"): string {
  return path.join(root, name);
}
