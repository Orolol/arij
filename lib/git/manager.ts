import simpleGit, { type SimpleGit } from "simple-git";
import path from "path";
import fs from "fs";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function getGit(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

/**
 * Generates the branch name for an epic.
 */
export function epicBranchName(epicId: string, epicTitle: string): string {
  return `feature/epic-${epicId}-${slugify(epicTitle)}`;
}

/**
 * Creates a worktree for an epic with a dedicated branch.
 * Returns the worktree path.
 */
export async function createWorktree(
  repoPath: string,
  epicId: string,
  epicTitle: string
): Promise<{ worktreePath: string; branchName: string }> {
  const git = getGit(repoPath);
  const branchName = epicBranchName(epicId, epicTitle);

  // Determine worktree directory next to the repo
  const worktreeBase = path.join(repoPath, "..", ".arij-worktrees");
  if (!fs.existsSync(worktreeBase)) {
    fs.mkdirSync(worktreeBase, { recursive: true });
  }
  const worktreePath = path.join(worktreeBase, branchName.replace(/\//g, "-"));

  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    return { worktreePath, branchName };
  }

  // Check if branch exists
  const branches = await git.branchLocal();
  const branchExists = branches.all.includes(branchName);

  if (branchExists) {
    // Create worktree from existing branch
    await git.raw(["worktree", "add", worktreePath, branchName]);
  } else {
    // Create new branch + worktree
    await git.raw(["worktree", "add", "-b", branchName, worktreePath]);
  }

  return { worktreePath, branchName };
}

/**
 * Removes a worktree and optionally its branch.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  removeBranch = false
): Promise<void> {
  const git = getGit(repoPath);

  if (fs.existsSync(worktreePath)) {
    await git.raw(["worktree", "remove", worktreePath, "--force"]);
  }

  await git.raw(["worktree", "prune"]);
}

/**
 * Lists all local branches in the repo.
 */
export async function listBranches(repoPath: string): Promise<string[]> {
  const git = getGit(repoPath);
  const branches = await git.branchLocal();
  return branches.all;
}

/**
 * Checks if a path is a valid git repository.
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const git = getGit(repoPath);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

/**
 * Gets the current branch of a repo/worktree.
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const git = getGit(repoPath);
  return (await git.branchLocal()).current;
}

/**
 * Lists active worktrees for the repo.
 */
export async function listWorktrees(
  repoPath: string
): Promise<Array<{ path: string; branch: string }>> {
  const git = getGit(repoPath);
  const raw = await git.raw(["worktree", "list", "--porcelain"]);
  const worktrees: Array<{ path: string; branch: string }> = [];

  let currentPath = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.replace("worktree ", "");
    } else if (line.startsWith("branch ")) {
      const branch = line.replace("branch refs/heads/", "");
      worktrees.push({ path: currentPath, branch });
    }
  }

  return worktrees;
}
