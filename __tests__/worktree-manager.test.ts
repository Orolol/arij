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
});
