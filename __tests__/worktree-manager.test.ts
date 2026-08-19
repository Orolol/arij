import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGit = {
  branchLocal: vi.fn(),
  raw: vi.fn(),
  checkout: vi.fn(),
  merge: vi.fn(),
  log: vi.fn(),
  deleteLocalBranch: vi.fn(),
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

import { createWorktree, mergeWorktree, resolveDefaultBranch } from "@/lib/git/manager";
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

  // A GitHub clone's default branch is often neither main nor master; basing
  // the epic branch on a guessed "master" failed with `invalid reference`.
  it("bases the branch on origin/HEAD when neither main nor master exists", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["develop", "other-branch"],
      current: "develop",
    });
    mockGit.raw.mockImplementation(async (args: string[]) =>
      args[0] === "symbolic-ref" ? "origin/develop\n" : ""
    );

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      "-b",
      "feature/epic-epic123-my-epic-title",
      expect.any(String),
      "develop",
    ]);
  });

  it("falls back to the checked-out branch when origin/HEAD is missing", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["trunk"],
      current: "trunk",
    });
    mockGit.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === "symbolic-ref") throw new Error("no origin/HEAD");
      return "";
    });

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      "-b",
      "feature/epic-epic123-my-epic-title",
      expect.any(String),
      "trunk",
    ]);
  });

  it("prefers main over origin/HEAD so existing repos are unaffected", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "develop"],
      current: "develop",
    });
    mockGit.raw.mockImplementation(async (args: string[]) =>
      args[0] === "symbolic-ref" ? "origin/develop\n" : ""
    );

    await createWorktree("/repo", "epic123", "My Epic Title");

    expect(mockGit.raw).not.toHaveBeenCalledWith(
      expect.arrayContaining(["symbolic-ref"])
    );
    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      "-b",
      "feature/epic-epic123-my-epic-title",
      expect.any(String),
      "main",
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

  // The project's stored default_branch (set by a GitHub import) is
  // authoritative: a gitflow repo may carry a local `main` while its GitHub
  // default is `develop`, and the imported value is the one the PR base and
  // the remote agree on.
  it("prefers the stored default branch over a local main", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "develop"],
      current: "develop",
    });
    mockGit.raw.mockResolvedValue("");

    await createWorktree("/repo", "epic123", "My Epic Title", "develop");

    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      "-b",
      "feature/epic-epic123-my-epic-title",
      expect.any(String),
      "develop",
    ]);
    expect(mockGit.raw).not.toHaveBeenCalledWith(
      expect.arrayContaining(["symbolic-ref"])
    );
  });

  it("falls through to the chain when the stored default branch is missing locally", async () => {
    // e.g. the default was deleted after the import: main wins again, and the
    // origin/HEAD lookup is not consulted either (main answers first).
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "feature-branch"],
      current: "main",
    });
    mockGit.raw.mockResolvedValue("");

    await createWorktree("/repo", "epic123", "My Epic Title", "develop");

    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      "-b",
      "feature/epic-epic123-my-epic-title",
      expect.any(String),
      "main",
    ]);
  });

  it("ignores an empty-string stored default branch", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["develop"],
      current: "develop",
    });
    mockGit.raw.mockImplementation(async (args: string[]) =>
      args[0] === "symbolic-ref" ? "origin/develop\n" : ""
    );

    await createWorktree("/repo", "epic123", "My Epic Title", "");

    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      "-b",
      "feature/epic-epic123-my-epic-title",
      expect.any(String),
      "develop",
    ]);
  });
});

describe("mergeWorktree", () => {
  const epicBranch = "feature/epic-epic123-my-epic-title";

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockGit.raw.mockResolvedValue("");
    mockGit.checkout.mockResolvedValue(undefined);
    mockGit.merge.mockResolvedValue({});
    mockGit.log.mockResolvedValue({ latest: { hash: "abc123" } });
    mockGit.deleteLocalBranch.mockResolvedValue(undefined);
  });

  function mockSymbolicRef(ref: string | null, error = false) {
    mockGit.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === "symbolic-ref") {
        if (error) throw new Error("no origin/HEAD");
        return ref;
      }
      return "";
    });
  }

  it("merges into origin/HEAD when the default branch is neither main nor master", async () => {
    // A GitHub clone whose default is `develop`: the old code guessed
    // `master` and failed with `invalid reference: master`.
    mockGit.branchLocal.mockResolvedValue({
      all: ["develop", epicBranch],
      current: "develop",
    });
    mockSymbolicRef("origin/develop\n");

    const result = await mergeWorktree("/repo", epicBranch);

    expect(result).toEqual({ merged: true, commitHash: "abc123" });
    expect(mockGit.checkout).toHaveBeenCalledWith("develop");
    expect(mockGit.merge).toHaveBeenCalledWith([
      epicBranch,
      "--no-ff",
      "-m",
      `Merge ${epicBranch}`,
    ]);
  });

  it("still prefers main over origin/HEAD so existing repos are unaffected", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "develop", epicBranch],
      current: "develop",
    });
    mockSymbolicRef("origin/develop\n");

    await mergeWorktree("/repo", epicBranch);

    expect(mockGit.checkout).toHaveBeenCalledWith("main");
    expect(mockGit.raw).not.toHaveBeenCalledWith(
      expect.arrayContaining(["symbolic-ref"])
    );
  });

  it("falls back to the checked-out branch when origin/HEAD is missing", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["trunk", epicBranch],
      current: "trunk",
    });
    mockSymbolicRef(null, true);

    const result = await mergeWorktree("/repo", epicBranch);

    expect(result.merged).toBe(true);
    expect(mockGit.checkout).toHaveBeenCalledWith("trunk");
  });

  it("reports a missing epic branch without touching the repo", async () => {
    mockGit.branchLocal.mockResolvedValue({ all: ["develop"], current: "develop" });
    mockSymbolicRef("origin/develop\n");

    const result = await mergeWorktree("/repo", "feature/missing");

    expect(result).toEqual({ merged: false, error: "Branch feature/missing not found" });
    expect(mockGit.checkout).not.toHaveBeenCalled();
  });

  it("prefers the stored default branch over a local main, like createWorktree", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "develop", epicBranch],
      current: "develop",
    });
    mockSymbolicRef("origin/develop\n");

    const result = await mergeWorktree("/repo", epicBranch, undefined, "develop");

    expect(result).toEqual({ merged: true, commitHash: "abc123" });
    expect(mockGit.checkout).toHaveBeenCalledWith("develop");
    expect(mockGit.raw).not.toHaveBeenCalledWith(
      expect.arrayContaining(["symbolic-ref"])
    );
  });

  it("falls back to the chain when the stored default branch is missing locally", async () => {
    mockGit.branchLocal.mockResolvedValue({
      all: ["main", "develop", epicBranch],
      current: "develop",
    });
    mockSymbolicRef("origin/develop\n");

    await mergeWorktree("/repo", epicBranch, undefined, "trunk");

    expect(mockGit.checkout).toHaveBeenCalledWith("main");
  });
});

describe("resolveDefaultBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers with origin/HEAD for a clone whose default is neither main nor master", async () => {
    mockGit.branchLocal.mockResolvedValue({ all: ["develop"], current: "develop" });
    mockGit.raw.mockImplementation(async (args: string[]) =>
      args[0] === "symbolic-ref" ? "origin/develop\n" : ""
    );

    expect(await resolveDefaultBranch("/repo")).toBe("develop");
  });

  it("keeps main as the first answer for existing repos", async () => {
    mockGit.branchLocal.mockResolvedValue({ all: ["main"], current: "main" });
    mockGit.raw.mockImplementation(async (args: string[]) =>
      args[0] === "symbolic-ref" ? "origin/develop\n" : ""
    );

    expect(await resolveDefaultBranch("/repo")).toBe("main");
  });

  it("answers with the stored default branch when it exists locally", async () => {
    mockGit.branchLocal.mockResolvedValue({ all: ["main", "develop"], current: "main" });
    mockGit.raw.mockImplementation(async (args: string[]) =>
      args[0] === "symbolic-ref" ? "origin/main\n" : ""
    );

    expect(await resolveDefaultBranch("/repo", "develop")).toBe("develop");
    // The stored value is trusted without an origin/HEAD lookup.
    expect(mockGit.raw).not.toHaveBeenCalledWith(
      expect.arrayContaining(["symbolic-ref"])
    );
  });

  it("ignores a stored default branch that no longer exists locally", async () => {
    mockGit.branchLocal.mockResolvedValue({ all: ["main"], current: "main" });
    mockGit.raw.mockImplementation(async (args: string[]) =>
      args[0] === "symbolic-ref" ? "origin/main\n" : ""
    );

    expect(await resolveDefaultBranch("/repo", "develop")).toBe("main");
  });
});
