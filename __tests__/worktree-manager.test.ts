import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGit = {
  branchLocal: vi.fn(),
  raw: vi.fn(),
};

vi.mock("simple-git", () => ({
  default: () => mockGit,
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

import { createWorktree } from "@/lib/git/manager";
import fs from "fs";

describe("createWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("creates new branch based on main when branch does not exist", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "other-branch"],
      current: "main",
    });
    mockGit.raw.mockResolvedValue("");

    await createWorktree("/repo", "epic123", "My Epic Title");

    // Verify the worktree add command includes "main" as the start point
    expect(mockGit.raw).toHaveBeenCalledWith(
      expect.arrayContaining([
        "worktree",
        "add",
        "-b",
        expect.stringContaining("feature/epic-epic123"),
        expect.any(String),
        "main",
      ])
    );
  });

  it("creates new branch based on master when main does not exist", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["master", "other-branch"],
      current: "master",
    });
    mockGit.raw.mockResolvedValue("");

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(mockGit.raw).toHaveBeenCalledWith(
      expect.arrayContaining([
        "worktree",
        "add",
        "-b",
        expect.stringContaining("feature/epic-epic123"),
        expect.any(String),
        "master",
      ])
    );
  });

  it("does not add base branch when using existing branch", async () => {
    const branchName = "feature/epic-epic123-my-epic-title";
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", branchName],
      current: "main",
    });
    mockGit.raw.mockResolvedValue("");

    await createWorktree("/repo", "epic123", "My Epic Title");

    // For existing branches, it should NOT include "main" as base
    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      expect.any(String),
      branchName,
    ]);
  });

  it("returns existing worktree without re-creating", async () => {
    // First call for .arij-worktrees dir: false, second for worktreePath: true
    (fs.existsSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true) // .arij-worktrees exists
      .mockReturnValueOnce(true); // worktree dir exists

    const result = await createWorktree("/repo", "epic123", "My Epic Title");

    expect(result.branchName).toContain("feature/epic-epic123");
    // Should not call git at all
    expect(mockGit.raw).not.toHaveBeenCalled();
  });
});

/**
 * Base-branch resolution. `main`-else-`master` was a guess that silently
 * picked a branch which may not exist: a repository whose default is `trunk`
 * or `develop` imported cleanly and then failed here, at `worktree add`.
 */
describe("createWorktree — base branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  /** `raw` serves both the origin/HEAD lookup and the worktree command. */
  function withRemoteHead(head: string | null) {
    mockGit.raw.mockImplementation(async (args: string[]) => {
      if (!args.includes("symbolic-ref")) return "";
      if (head === null) throw new Error("fatal: ref is not a symbolic ref");
      return `${head}\n`;
    });
  }

  function baseBranchUsed(): string {
    const call = mockGit.raw.mock.calls.find((args) =>
      (args[0] as string[]).includes("worktree")
    );
    if (!call) throw new Error("worktree was never created");
    return (call[0] as string[]).at(-1) as string;
  }

  it("bases a new branch on the branch origin advertises as default", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["trunk", "other-branch"],
      current: "trunk",
    });
    withRemoteHead("origin/trunk");

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(baseBranchUsed()).toBe("trunk");
  });

  it("prefers the remote default over a local main", async () => {
    // A repository that keeps `main` around but develops on `develop`.
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "develop"],
      current: "develop",
    });
    withRemoteHead("origin/develop");

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(baseBranchUsed()).toBe("develop");
  });

  it("ignores a remote default that has no local branch", async () => {
    // `main` on its own does not resolve to refs/remotes/origin/main, so
    // handing it to git as a start-point would just fail differently.
    mockGit.branchLocal.mockResolvedValue({
      all: ["master"],
      current: "master",
    });
    withRemoteHead("origin/main");

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(baseBranchUsed()).toBe("master");
  });

  it("falls back to the checked-out branch when no convention applies", async () => {
    // No remote to ask and neither main nor master present: the old guess
    // returned "master" here and the worktree could never be created.
    mockGit.branchLocal.mockResolvedValue({
      all: ["trunk"],
      current: "trunk",
    });
    withRemoteHead(null);

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(baseBranchUsed()).toBe("trunk");
  });
});
