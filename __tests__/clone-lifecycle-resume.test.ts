import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Story: "As a user whose import was interrupted, I want to resume from the
 * existing clone" — the on-disk classification that decides between reuse,
 * conflict and replace, against real git repositories.
 */

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  classifyCloneDestination,
  detectDefaultBranch,
} from "@/lib/git/clone";

let tmpRoot: string;

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

function makeRepo(
  name: string,
  options: { origin?: string; commit?: boolean; branch?: string } = {}
): string {
  const { origin, commit = true, branch = "main" } = options;
  const repoPath = path.join(tmpRoot, name);
  fs.mkdirSync(repoPath, { recursive: true });
  git(repoPath, "init", `--initial-branch=${branch}`);
  if (origin) git(repoPath, "remote", "add", "origin", origin);
  if (commit) {
    fs.writeFileSync(path.join(repoPath, "README.md"), "# test\n");
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "initial");
  }
  return repoPath;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arij-clone-resume-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const OWNER_REPO = { owner: "owner", repo: "repo" };

describe("classifyCloneDestination", () => {
  it("reports an absent destination", async () => {
    const result = await classifyCloneDestination(
      path.join(tmpRoot, "nothing-here"),
      OWNER_REPO
    );

    expect(result.state).toBe("absent");
  });

  it("reports an empty destination", async () => {
    const dest = path.join(tmpRoot, "empty");
    fs.mkdirSync(dest);

    expect((await classifyCloneDestination(dest, OWNER_REPO)).state).toBe("empty");
  });

  it("reuses a healthy clone of the same repository", async () => {
    const repoPath = makeRepo("owner-repo", {
      origin: "https://github.com/owner/repo.git",
    });

    const result = await classifyCloneDestination(repoPath, OWNER_REPO);

    expect(result.state).toBe("healthy_match");
    expect(result.existingRemote).toBe("owner/repo");
  });

  it("matches the same repository across remote URL forms and casing", async () => {
    for (const [index, origin] of [
      "git@github.com:Owner/Repo.git",
      "ssh://git@github.com/owner/repo",
      "https://github.com/OWNER/REPO.git",
      "git://github.com/owner/repo.git",
    ].entries()) {
      const repoPath = makeRepo(`variant-${index}`, { origin });
      const result = await classifyCloneDestination(repoPath, OWNER_REPO);
      expect(result.state, origin).toBe("healthy_match");
    }
  });

  it("reports a clone of a different repository as a conflict", async () => {
    const repoPath = makeRepo("owner-repo", {
      origin: "https://github.com/someone-else/other.git",
    });

    const result = await classifyCloneDestination(repoPath, OWNER_REPO);

    expect(result.state).toBe("remote_mismatch");
    expect(result.existingRemote).toBe("someone-else/other");
  });

  it("treats a matching repository with an unborn HEAD as interrupted debris, not a conflict", async () => {
    // A clone killed mid-transfer: `.git` exists, origin is right, but nothing
    // is checked out.
    const repoPath = makeRepo("owner-repo", {
      origin: "https://github.com/owner/repo.git",
      commit: false,
    });
    fs.writeFileSync(path.join(repoPath, "partial.bin"), "x");

    const result = await classifyCloneDestination(repoPath, OWNER_REPO);

    expect(result.state).toBe("partial_clone");
    expect(result.state).not.toBe("remote_mismatch");
  });

  it("treats a non-repository directory as interrupted debris, not a conflict", async () => {
    const dest = path.join(tmpRoot, "owner-repo");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "half-downloaded"), "x");

    const result = await classifyCloneDestination(dest, OWNER_REPO);

    expect(result.state).toBe("partial_clone");
  });

  it("treats a git repository with no remote as interrupted debris", async () => {
    const repoPath = makeRepo("owner-repo");

    expect((await classifyCloneDestination(repoPath, OWNER_REPO)).state).toBe(
      "partial_clone"
    );
  });
});

describe("detectDefaultBranch", () => {
  it("returns the checked-out branch", async () => {
    const repoPath = makeRepo("owner-repo", { branch: "develop" });

    expect(await detectDefaultBranch(repoPath)).toBe("develop");
  });

  it("falls back to main when the branch cannot be determined", async () => {
    expect(await detectDefaultBranch(path.join(tmpRoot, "missing"))).toBe("main");
  });
});

describe("import short-circuit on a reused clone", () => {
  it("skips Claude analysis when the clone already contains a valid arji.json", async () => {
    const clonePath = path.join(tmpRoot, "owner-repo");
    fs.mkdirSync(clonePath, { recursive: true });
    fs.writeFileSync(
      path.join(clonePath, "arji.json"),
      JSON.stringify({
        project: { name: "Demo", description: "From the clone" },
        epics: [{ title: "First epic", status: "backlog", user_stories: [] }],
      })
    );

    const { mockJsonRequest } = await import("@/__tests__/helpers/db-mock");
    const { POST } = await import("@/app/api/projects/import/route");

    const response = await POST(mockJsonRequest({ path: clonePath }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.fromExistingFile).toBe(true);
    expect(json.data.preview.project.name).toBe("Demo");
    expect(json.data.path).toBe(fs.realpathSync(clonePath));
    // The point of the short-circuit: no LLM was spawned.
    expect(spawnClaude).not.toHaveBeenCalled();
  });
});

const spawnClaude = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/spawn", () => ({ spawnClaude }));
