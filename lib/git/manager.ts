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

  // Determine the main branch to base new branches from
  const mainBranch = branches.all.includes("main") ? "main" : "master";

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
 * Attaches a worktree to an EXISTING branch, by exact name.
 *
 * `createWorktree` derives the branch from the epic title, which is the right
 * thing when creating one but wrong when re-attaching: a title edited since
 * the branch was cut would produce a different name and silently start work
 * on a fresh branch off main. Callers that already know the branch (it is
 * persisted on `epics.branch_name`) use this instead.
 */
export async function attachWorktree(
  repoPath: string,
  branchName: string
): Promise<{ worktreePath: string; branchName: string }> {
  const git = getGit(repoPath);

  const worktreeBase = path.join(repoPath, "..", ".arij-worktrees");
  if (!fs.existsSync(worktreeBase)) {
    fs.mkdirSync(worktreeBase, { recursive: true });
  }
  const worktreePath = path.join(worktreeBase, branchName.replace(/\//g, "-"));

  if (fs.existsSync(worktreePath)) {
    return { worktreePath, branchName };
  }

  const branches = await git.branchLocal();
  if (!branches.all.includes(branchName)) {
    throw new Error(`Branch ${branchName} not found`);
  }

  await git.raw(["worktree", "add", worktreePath, branchName]);
  return { worktreePath, branchName };
}

/** Why a merge did not happen — callers react very differently to each. */
export type MergeFailureReason =
  /** Real content conflict: a resolution agent can fix this. */
  | "conflict"
  /** The branch is gone (already merged, or deleted). No agent can help. */
  | "branch-missing"
  /** Anything else — worktree removal, checkout, a broken repo. */
  | "error";

export interface MergeWorktreeResult {
  merged: boolean;
  commitHash?: string;
  error?: string;
  /** Present only when `merged` is false. */
  reason?: MergeFailureReason;
}

/**
 * Enough state to undo a merge: where `main` and the branch pointed before it.
 * Captured by `captureMergeCheckpoint`, consumed by `rollbackMerge`.
 */
export interface MergeCheckpoint {
  mainBranch: string;
  mainHead: string;
  branchName: string;
  branchHead: string;
}

/** Resolves the repo's integration branch — "main", else "master". */
async function resolveMainBranch(git: SimpleGit): Promise<string> {
  const branches = await git.branchLocal();
  return branches.all.includes("main") ? "main" : "master";
}

/**
 * Records where `main` and the epic branch point right now, so a merge that
 * turns out to have been unwanted can be undone. Returns null when the state
 * cannot be captured — the caller then simply has no rollback available.
 */
export async function captureMergeCheckpoint(
  repoPath: string,
  branchName: string
): Promise<MergeCheckpoint | null> {
  try {
    const git = getGit(repoPath);
    const mainBranch = await resolveMainBranch(git);
    const mainHead = (await git.revparse([mainBranch])).trim();
    const branchHead = (await git.revparse([branchName])).trim();
    return { mainBranch, mainHead, branchName, branchHead };
  } catch {
    return null;
  }
}

/**
 * Undoes a merge captured by {@link captureMergeCheckpoint}: resets `main`
 * back to its pre-merge commit and restores the branch `mergeWorktree`
 * deleted. Used by unattended callers that must not leave `main` changed when
 * a post-merge check refuses the transition.
 */
export async function rollbackMerge(
  repoPath: string,
  checkpoint: MergeCheckpoint
): Promise<{ restored: boolean; error?: string }> {
  const git = getGit(repoPath);
  try {
    await git.checkout(checkpoint.mainBranch);
    await git.reset(["--hard", checkpoint.mainHead]);

    const branches = await git.branchLocal();
    if (!branches.all.includes(checkpoint.branchName)) {
      await git.raw(["branch", checkpoint.branchName, checkpoint.branchHead]);
    }
    return { restored: true };
  } catch (e) {
    return {
      restored: false,
      error: e instanceof Error ? e.message : "Rollback failed",
    };
  }
}

/**
 * Merges an epic branch into the main branch, then removes the worktree.
 * Returns the merge commit hash on success.
 *
 * Error handling is split at the point of no return. Everything up to and
 * including `git merge` can fail without `main` having changed, so those
 * failures report `merged: false` with a reason the caller can act on. Once
 * the merge command succeeds `main` HAS changed, and a later hiccup — the
 * `git log` lookup, or deleting the merged branch — must NOT be reported as
 * "not merged": a caller told that would go on to dispatch a
 * conflict-resolution agent for a merge that already landed.
 */
export async function mergeWorktree(
  repoPath: string,
  branchName: string,
  worktreePath?: string
): Promise<MergeWorktreeResult> {
  const git = getGit(repoPath);

  // ---- Pre-merge: nothing here can have modified main. -------------------
  try {
    const branches = await git.branchLocal();
    const mainBranch = branches.all.includes("main") ? "main" : "master";

    if (!branches.all.includes(branchName)) {
      return {
        merged: false,
        error: `Branch ${branchName} not found`,
        reason: "branch-missing",
      };
    }

    // Remove the worktree first (git can't merge while worktree is active)
    if (worktreePath && fs.existsSync(worktreePath)) {
      await git.raw(["worktree", "remove", worktreePath, "--force"]);
      await git.raw(["worktree", "prune"]);
    }

    await git.checkout(mainBranch);
  } catch (e) {
    return {
      merged: false,
      error: e instanceof Error ? e.message : "Merge failed",
      reason: "error",
    };
  }

  // ---- The merge itself: the only step that can conflict. ----------------
  try {
    await git.merge([branchName, "--no-ff", "-m", `Merge ${branchName}`]);
  } catch (e) {
    try {
      await git.merge(["--abort"]);
    } catch {
      // ignore abort errors
    }
    return {
      merged: false,
      error: e instanceof Error ? e.message : "Merge failed",
      reason: "conflict",
    };
  }

  // ---- Post-merge: main has changed. Cleanup is best-effort. -------------
  let commitHash: string | undefined;
  try {
    commitHash = (await git.log({ maxCount: 1 })).latest?.hash;
  } catch (e) {
    console.warn(
      "[git] Merge landed but the commit hash lookup failed:",
      e instanceof Error ? e.message : e
    );
  }

  try {
    await git.deleteLocalBranch(branchName, true);
  } catch (e) {
    console.warn(
      `[git] Merge landed but deleting ${branchName} failed:`,
      e instanceof Error ? e.message : e
    );
  }

  return { merged: true, commitHash };
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
