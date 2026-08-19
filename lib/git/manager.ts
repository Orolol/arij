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
 * Resolves the branch new epic branches are cut from.
 *
 * `main` and `master` keep priority so existing repos behave exactly as before.
 * Beyond them the clone itself is asked: `origin/HEAD` records the branch the
 * remote reports as default, which for a GitHub import is frequently neither
 * (`develop`, `trunk`). Guessing `master` there made `worktree add` fail
 * outright with `invalid reference: master`, so a freshly cloned project could
 * never be sent to dev.
 */
async function resolveBaseBranch(
  git: SimpleGit,
  localBranches: string[],
  currentBranch: string
): Promise<string> {
  if (localBranches.includes("main")) return "main";
  if (localBranches.includes("master")) return "master";

  try {
    const head = await git.raw([
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    const remoteDefault = head?.trim().replace(/^origin\//, "");
    if (remoteDefault) return remoteDefault;
  } catch {
    // No remote, or no origin/HEAD ref — the checked-out branch is the best
    // remaining answer.
  }

  return currentBranch || "master";
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
    // Resolved lazily: an existing branch needs no start point.
    const baseBranch = await resolveBaseBranch(
      git,
      branches.all,
      branches.current
    );
    // Create new branch + worktree, explicitly based from the default branch
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
    // Get the main branch name
    const branches = await git.branchLocal();
    const mainBranch = branches.all.includes("main") ? "main" : "master";

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
