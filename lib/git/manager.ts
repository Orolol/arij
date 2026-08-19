import simpleGit, { type SimpleGit } from "simple-git";
import path from "path";
import fs from "fs";
import { resolveRemoteDefaultBranch } from "./remote";

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
 * The branch epic work should be based on and merged back into.
 *
 * `main`-else-`master` is a guess, and it is wrong for every repository whose
 * default is `trunk`, `develop` or `dev`: such a repo imports cleanly and then
 * fails at `worktree add` against a branch that does not exist. Ask the
 * repository instead — `origin/HEAD` records what the remote considers
 * default — and only fall back to the guess when there is no remote to ask.
 *
 * The remote's answer is only used when the branch is actually present
 * locally: `main` on its own does not resolve to `refs/remotes/origin/main`,
 * so handing git a start-point it cannot resolve would trade one failure for
 * another.
 */
async function resolveBaseBranch(
  repoPath: string,
  branches: { all: string[]; current: string }
): Promise<string> {
  const remoteDefault = await resolveRemoteDefaultBranch(repoPath);
  if (remoteDefault && branches.all.includes(remoteDefault)) {
    return remoteDefault;
  }

  if (branches.all.includes("main")) return "main";
  if (branches.all.includes("master")) return "master";
  // Neither convention is present and the remote had no opinion: the checked
  // out branch is the only one guaranteed to exist.
  return branches.current || branches.all[0] || "main";
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
    // Create new branch + worktree, explicitly based from the default branch
    const baseBranch = await resolveBaseBranch(repoPath, branches);
    await git.raw([
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      baseBranch,
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
  worktreePath?: string
): Promise<{ merged: boolean; commitHash?: string; error?: string }> {
  const git = getGit(repoPath);

  try {
    // Get the branch epic work merges back into
    const branches = await git.branchLocal();
    const mainBranch = await resolveBaseBranch(repoPath, branches);

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
