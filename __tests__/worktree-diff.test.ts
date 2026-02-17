import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock simple-git before importing the module under test
const mockGit = {
  revparse: vi.fn(),
  raw: vi.fn(),
  status: vi.fn(),
  diff: vi.fn(),
};

vi.mock("simple-git", () => ({
  default: () => mockGit,
}));

import { getWorktreeDiff } from "@/lib/git/diff";

describe("getWorktreeDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns metadata with ahead/behind counts", async () => {
    mockGit.revparse.mockResolvedValue("feature/my-branch");
    mockGit.raw.mockImplementation((args: string[]) => {
      if (args[0] === "merge-base") return Promise.resolve("abc123\n");
      if (args[0] === "rev-list") return Promise.resolve("0\t3\n");
      return Promise.resolve("");
    });
    mockGit.status.mockResolvedValue({
      modified: [],
      not_added: [],
      staged: [],
      deleted: [],
      renamed: [],
      created: [],
    });
    mockGit.diff.mockResolvedValue("");

    const result = await getWorktreeDiff("/fake/worktree");

    expect(result.metadata.branchName).toBe("feature/my-branch");
    expect(result.metadata.baseBranch).toBe("main");
    expect(result.metadata.ahead).toBe(3);
    expect(result.metadata.behind).toBe(0);
    expect(result.metadata.mergeBaseCommit).toBe("abc123");
    expect(result.metadata.hasUncommittedChanges).toBe(false);
  });

  it("detects uncommitted changes", async () => {
    mockGit.revparse.mockResolvedValue("feature/branch");
    mockGit.raw.mockImplementation((args: string[]) => {
      if (args[0] === "merge-base") return Promise.resolve("abc123\n");
      if (args[0] === "rev-list") return Promise.resolve("0\t0\n");
      return Promise.resolve("");
    });
    mockGit.status.mockResolvedValue({
      modified: ["file.ts"],
      not_added: [],
      staged: [],
      deleted: [],
      renamed: [],
      created: [],
    });
    mockGit.diff.mockResolvedValue("");

    const result = await getWorktreeDiff("/fake/worktree");

    expect(result.metadata.hasUncommittedChanges).toBe(true);
  });

  it("falls back when merge-base fails", async () => {
    mockGit.revparse.mockResolvedValue("feature/branch");
    mockGit.raw.mockImplementation((args: string[]) => {
      if (args[0] === "merge-base") return Promise.reject(new Error("no merge base"));
      if (args[0] === "rev-list") return Promise.resolve("0\t0\n");
      return Promise.resolve("");
    });
    mockGit.status.mockResolvedValue({
      modified: [],
      not_added: [],
      staged: [],
      deleted: [],
      renamed: [],
      created: [],
    });
    mockGit.diff.mockResolvedValue("");

    const result = await getWorktreeDiff("/fake/worktree");

    expect(result.metadata.mergeBaseCommit).toBeNull();
    expect(result.files).toEqual([]);
  });

  it("shows uncommitted diff when branch has not diverged", async () => {
    mockGit.revparse.mockResolvedValue("feature/branch");
    mockGit.raw.mockImplementation((args: string[]) => {
      if (args[0] === "merge-base") return Promise.resolve("abc123\n");
      if (args[0] === "rev-list") return Promise.resolve("0\t0\n");
      return Promise.resolve("");
    });
    mockGit.status.mockResolvedValue({
      modified: ["file.ts"],
      not_added: [],
      staged: [],
      deleted: [],
      renamed: [],
      created: [],
    });

    // First call: merge-base diff (empty)
    // Second/third calls: uncommitted changes
    let diffCallCount = 0;
    mockGit.diff.mockImplementation((args: string[]) => {
      diffCallCount++;
      if (diffCallCount === 1) return ""; // merge-base diff
      if (diffCallCount === 2) {
        // git diff -U3 (uncommitted)
        return [
          "diff --git a/file.ts b/file.ts",
          "index abc..def 100644",
          "--- a/file.ts",
          "+++ b/file.ts",
          "@@ -1,2 +1,2 @@",
          "-old line",
          "+new line",
          " unchanged",
        ].join("\n");
      }
      return ""; // staged diff
    });

    const result = await getWorktreeDiff("/fake/worktree");

    expect(result.files).toHaveLength(1);
    expect(result.files[0].filePath).toBe("file.ts");
  });

  it("returns committed diff when branch has diverged", async () => {
    const diffOutput = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index abc..def 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,3 @@",
      " line 1",
      "+new line",
      " line 2",
    ].join("\n");

    mockGit.revparse.mockResolvedValue("feature/branch");
    mockGit.raw.mockImplementation((args: string[]) => {
      if (args[0] === "merge-base") return Promise.resolve("abc123\n");
      if (args[0] === "rev-list") return Promise.resolve("0\t2\n");
      return Promise.resolve("");
    });
    mockGit.status.mockResolvedValue({
      modified: [],
      not_added: [],
      staged: [],
      deleted: [],
      renamed: [],
      created: [],
    });
    mockGit.diff.mockResolvedValue(diffOutput);

    const result = await getWorktreeDiff("/fake/worktree");

    expect(result.files).toHaveLength(1);
    expect(result.metadata.ahead).toBe(2);
    expect(result.metadata.behind).toBe(0);
  });

  it("uses custom base branch", async () => {
    mockGit.revparse.mockResolvedValue("feature/branch");
    mockGit.raw.mockImplementation((args: string[]) => {
      if (args[0] === "merge-base") {
        expect(args[1]).toBe("develop");
        return Promise.resolve("abc123\n");
      }
      if (args[0] === "rev-list") {
        expect(args[3]).toBe("develop...HEAD");
        return Promise.resolve("1\t0\n");
      }
      return Promise.resolve("");
    });
    mockGit.status.mockResolvedValue({
      modified: [],
      not_added: [],
      staged: [],
      deleted: [],
      renamed: [],
      created: [],
    });
    mockGit.diff.mockResolvedValue("");

    const result = await getWorktreeDiff("/fake/worktree", "develop");

    expect(result.metadata.baseBranch).toBe("develop");
  });
});
