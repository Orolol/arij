import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockGetWorktreeDiff = vi.hoisted(() => vi.fn());
const mockCreateWorktree = vi.hoisted(() => vi.fn());
const mockIsGitRepo = vi.hoisted(() => vi.fn());
const mockResolveDefaultBranch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/git/diff", () => ({
  getWorktreeDiff: mockGetWorktreeDiff,
}));

vi.mock("@/lib/git/manager", () => ({
  createWorktree: mockCreateWorktree,
  isGitRepo: mockIsGitRepo,
  resolveDefaultBranch: mockResolveDefaultBranch,
}));

const diffResult = {
  files: [],
  metadata: {
    branchName: "feature/epic-1",
    baseBranch: "develop",
    ahead: 2,
    behind: 0,
    hasUncommittedChanges: false,
    mergeBaseCommit: "abc123",
  },
};

/**
 * GET /api/projects/[projectId]/epics/[epicId]/diff — base branch.
 *
 * A hard-coded "main" fails `merge-base` on a develop-default clone and
 * silently produces an empty diff with 0 ahead/behind — the review screen
 * would then claim the branch "has not diverged" over an epic with real
 * commits. The route must diff against the branch the worktree was cut from.
 */
describe("GET /api/projects/[projectId]/epics/[epicId]/diff — base branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockIsGitRepo.mockResolvedValue(true);
    mockCreateWorktree.mockResolvedValue({
      worktreePath: "/repo/../.arij-worktrees/feature-epic-1",
      branchName: "feature/epic-1",
    });
    mockGetWorktreeDiff.mockResolvedValue(diffResult);
    mockResolveDefaultBranch.mockResolvedValue("trunk");

    dbMockState.getQueue = [
      // getEpicOr404
      {
        id: "epic-1",
        projectId: "proj-1",
        title: "Epic One",
        branchName: "feature/epic-1",
      },
      // getProjectOr404
      {
        id: "proj-1",
        gitRepoPath: "/repo",
        defaultBranch: "develop",
      },
    ];
  });

  async function getDiff() {
    const { GET } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/diff/route"
    );
    return GET(
      mockNextRequest(),
      mockRouteContext({ projectId: "proj-1", epicId: "epic-1" })
    );
  }

  it("diffs against the project's stored default branch", async () => {
    const res = await getDiff();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(diffResult);
    expect(mockGetWorktreeDiff).toHaveBeenCalledWith(
      "/repo/../.arij-worktrees/feature-epic-1",
      "develop"
    );
    // The stored value is authoritative — the repo itself is not consulted.
    expect(mockResolveDefaultBranch).not.toHaveBeenCalled();
    // The worktree is cut from the same stored default.
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      "/repo",
      "epic-1",
      "Epic One",
      "develop"
    );
  });

  it("asks the repository itself when the project has no stored default", async () => {
    dbMockState.getQueue[1] = {
      id: "proj-1",
      gitRepoPath: "/repo",
      defaultBranch: null,
    };

    const res = await getDiff();

    expect(res.status).toBe(200);
    expect(mockResolveDefaultBranch).toHaveBeenCalledWith("/repo");
    expect(mockGetWorktreeDiff).toHaveBeenCalledWith(
      "/repo/../.arij-worktrees/feature-epic-1",
      "trunk"
    );
  });

  it("reports a resolver failure through the diff error path", async () => {
    dbMockState.getQueue[1] = {
      id: "proj-1",
      gitRepoPath: "/repo",
      defaultBranch: null,
    };
    mockResolveDefaultBranch.mockRejectedValue(
      new Error("fatal: not a git repository")
    );

    const res = await getDiff();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain("not a git repository");
    expect(mockGetWorktreeDiff).not.toHaveBeenCalled();
  });
});