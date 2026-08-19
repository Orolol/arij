import simpleGit, { type SimpleGit } from "simple-git";
import path from "path";
import fs from "fs";
import { resolveBaseBranch } from "./base-branch";

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
 * Options shared by the operations that need to know the repository's base
 * branch. `defaultBranch` is `projects.default_branch` — recorded when Arij
 * cloned the repository, and null for user-supplied paths, where
 * {@link resolveBaseBranch} falls back to asking git.
 */
export interface BaseBranchOptions {
  defaultBranch?: string | null;
}

/**
 * Creates a worktree for an epic with a dedicated branch.
 * Returns the worktree path.
 */
export async function createWorktree(
  repoPath: string,
  epicId: string,
  epicTitle: string,
  options: BaseBranchOptions = {}
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

  // Determine the branch to base new branches from
  const mainBranch = await resolveBaseBranch(git, branches.all, {
    preferred: options.defaultBranch,
  });

  if (branchExists) {
    // Create worktree from existing branch
    await git.raw(["worktree", "add", worktreePath, branchName]);
  } else {
    // Create new branch + worktree, explicitly based from main
    await git.raw([
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      mainBranch,
    ]);
  }

  return { worktreePath, branchName };
}

/**
 * Merges an epic branch into the main branch, then removes the worktree.
 * Returns the merge commit hash on success.
 */
export async function mergeWorktree(
  repoPath: string,
  branchName: string,
  worktreePath?: string,
  options: BaseBranchOptions = {}
): Promise<{ merged: boolean; commitHash?: string; error?: string }> {
  const git = getGit(repoPath);

  try {
    // Get the branch to merge into
    const branches = await git.branchLocal();
    const mainBranch = await resolveBaseBranch(git, branches.all, {
      preferred: options.defaultBranch,
    });

    // Make sure the branch exists
    if (!branches.all.includes(branchName)) {
      return { merged: false, error: `Branch ${branchName} not found` };
    }

    // Remove the worktree first (git can't merge while worktree is active)
    if (worktreePath && fs.existsSync(worktreePath)) {
      await git.raw(["worktree", "remove", worktreePath, "--force"]);
      await git.raw(["worktree", "prune"]);
    }

    // Checkout main
    await git.checkout(mainBranch);

    // Merge the epic branch
    const result = await git.merge([branchName, "--no-ff", "-m", `Merge ${branchName}`]);

    // Get the merge commit hash
    const log = await git.log({ maxCount: 1 });
    const commitHash = log.latest?.hash;

    // Delete the merged branch
    await git.deleteLocalBranch(branchName, true);

    return { merged: true, commitHash };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Merge failed";
    // If merge failed with conflicts, abort it
    try {
      await git.merge(["--abort"]);
    } catch {
      // ignore abort errors
    }
    return { merged: false, error: errorMsg };
  }
}

/**
 * Starts a merge of targetBranch into the worktree's current branch.
 * If the merge succeeds cleanly, returns { conflicted: false }.
 * If there are conflicts, leaves the worktree in a conflicted state
 * (does NOT abort) so an agent can resolve them.
 */
export async function startMergeInWorktree(
  worktreePath: string,
  targetBranch: string
): Promise<{ conflicted: boolean; output: string }> {
  const git = getGit(worktreePath);

  try {
    // Fetch latest so the target branch ref is up to date
    const result = await git.merge([targetBranch]);
    return { conflicted: false, output: result.result || "Merge completed cleanly." };
  } catch (e) {
    const output = e instanceof Error ? e.message : "Merge failed with conflicts";
    // Check if there are actually conflicted files
    const status = await git.status();
    if (status.conflicted.length > 0) {
      return { conflicted: true, output };
    }
    // Not a conflict — some other merge error; re-throw
    throw e;
  }
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
