import fs from "node:fs";
import fsp from "node:fs/promises";
import simpleGit from "simple-git";
import { listWorktrees } from "@/lib/git/worktrees";
import { redactedErrorMessage } from "@/lib/git/redact";
import {
  containsPathOnDisk,
  isInsideProjectsRoot,
  resolveProjectsRoot,
} from "./workspace";

/**
 * Removal of an app-managed clone from disk.
 *
 * The rule this module exists to enforce: **Arij only deletes directories Arij
 * created.** Two independent gates have to pass before a single file is
 * touched — the project must be flagged `clone_source = "github"` (Arij cloned
 * it), and the resolved path must still be a strict descendant of the *current*
 * projects root (it is still where Arij puts clones). A user-supplied
 * `gitRepoPath` fails the first gate and is untouchable no matter what.
 *
 * Neither gate is a request error: the project is deleted either way, and the
 * response reports why the directory was left alone.
 */

export type CloneRemovalSkipReason =
  /** The project has no `gitRepoPath` at all. */
  | "no_path"
  /** `clone_source` is NULL — a user-supplied directory Arij must not delete. */
  | "not_managed"
  /** The path is outside the configured projects root (moved root, hand-edited row). */
  | "outside_projects_root"
  /** Flagged and in-root, but already gone from disk. */
  | "missing";

export const CLONE_REMOVAL_SKIP_MESSAGES: Record<CloneRemovalSkipReason, string> = {
  no_path: "Project has no repository path; nothing to remove.",
  not_managed:
    "Directory left untouched: this project's repository was supplied by you, not cloned by Arij.",
  outside_projects_root:
    "Directory left untouched: it is outside the configured projects root.",
  missing: "Directory was already gone; nothing to remove.",
};

export interface ProjectClonePointer {
  gitRepoPath: string | null;
  cloneSource: string | null;
}

export type RemovableCloneCheck =
  | { ok: true; path: string }
  | { ok: false; reason: CloneRemovalSkipReason };

/** The `clone_source` value that marks a directory as Arij-created. */
export const GITHUB_CLONE_SOURCE = "github";

/**
 * Decides whether a project's directory may be removed, without touching it.
 *
 * Exported separately from {@link removeProjectClone} so the two guards can be
 * unit-tested exhaustively — they are the whole safety story of this feature.
 */
export function resolveRemovableClonePath(
  project: ProjectClonePointer,
  projectsRoot: string
): RemovableCloneCheck {
  const rawPath = project.gitRepoPath?.trim();
  if (!rawPath) return { ok: false, reason: "no_path" };

  if (project.cloneSource !== GITHUB_CLONE_SOURCE) {
    return { ok: false, reason: "not_managed" };
  }

  // Plain containment first (cheap, and the only check that applies when the
  // path does not exist), then the symlink-collapsing variant.
  if (
    !isInsideProjectsRoot(rawPath, projectsRoot) ||
    !containsPathOnDisk(rawPath, projectsRoot)
  ) {
    return { ok: false, reason: "outside_projects_root" };
  }

  return { ok: true, path: rawPath };
}

export interface CloneRemovalResult {
  removed: boolean;
  /** The directory that was (or would have been) removed. */
  path: string | null;
  /** Worktree directories removed alongside the clone. */
  worktreesRemoved: string[];
  /** Stale worktree records dropped by `git worktree prune`. */
  worktreesPruned: number;
  reason?: CloneRemovalSkipReason;
  message?: string;
  /** Set when removal was attempted and failed; already credential-redacted. */
  error?: string;
}

function skip(reason: CloneRemovalSkipReason, path: string | null): CloneRemovalResult {
  return {
    removed: false,
    path,
    worktreesRemoved: [],
    worktreesPruned: 0,
    reason,
    message: CLONE_REMOVAL_SKIP_MESSAGES[reason],
  };
}

/**
 * Detaches and deletes every worktree git has registered for this clone.
 *
 * Uses git's own registry rather than guessing directory names: worktrees are
 * named after the branch, not the repository, so two clones sharing a branch
 * name would otherwise be indistinguishable inside `.arij-worktrees`. The
 * shared `.arij-worktrees` directory itself is never removed — it belongs to
 * every clone under the root, not to this one.
 */
async function removeWorktrees(
  repoPath: string,
  projectsRoot: string
): Promise<{ removed: string[]; pruned: number }> {
  // simple-git throws synchronously from its factory for a missing directory,
  // so every use sits inside a guard — the repo can vanish under us at any point.
  const runGit = async (args: string[]): Promise<void> => {
    await simpleGit(repoPath).raw(args);
  };

  let prunedBefore = 0;
  try {
    const before = await listWorktrees(repoPath);
    prunedBefore = before.filter((worktree) => worktree.orphaned).length;
    await runGit(["worktree", "prune"]);
  } catch (error) {
    console.warn(
      "[clone-cleanup] worktree prune failed:",
      redactedErrorMessage(error)
    );
  }

  let entries: Awaited<ReturnType<typeof listWorktrees>> = [];
  try {
    entries = await listWorktrees(repoPath);
  } catch (error) {
    console.warn(
      "[clone-cleanup] worktree list failed:",
      redactedErrorMessage(error)
    );
    return { removed: [], pruned: prunedBefore };
  }

  const removed: string[] = [];
  for (const worktree of entries) {
    if (worktree.isMain) continue;
    // Same containment rule as the clone itself: a worktree that somehow points
    // outside the projects root is reported, never deleted.
    if (!containsPathOnDisk(worktree.path, projectsRoot)) {
      console.warn(
        "[clone-cleanup] skipping worktree outside projects root:",
        worktree.path
      );
      continue;
    }

    try {
      await runGit(["worktree", "remove", worktree.path, "--force"]);
    } catch {
      // git refuses for records whose directory is already gone; the explicit
      // rm below is the fallback.
    }

    try {
      await fsp.rm(worktree.path, { recursive: true, force: true });
      removed.push(worktree.path);
    } catch (error) {
      console.warn(
        "[clone-cleanup] failed to remove worktree",
        worktree.path,
        redactedErrorMessage(error)
      );
    }
  }

  try {
    await runGit(["worktree", "prune"]);
  } catch {
    // best-effort; the repository is about to be deleted anyway
  }

  return { removed, pruned: prunedBefore };
}

/**
 * Removes an app-managed clone and its worktrees.
 *
 * Never throws: a filesystem failure is reported on the result so the project
 * deletion it accompanies can still succeed.
 */
export async function removeProjectClone(
  project: ProjectClonePointer,
  options: { projectsRoot?: string } = {}
): Promise<CloneRemovalResult> {
  const projectsRoot = options.projectsRoot ?? resolveProjectsRoot();
  const check = resolveRemovableClonePath(project, projectsRoot);

  if (!check.ok) {
    return skip(check.reason, project.gitRepoPath ?? null);
  }

  if (!fs.existsSync(check.path)) {
    return skip("missing", check.path);
  }

  const worktrees = await removeWorktrees(check.path, projectsRoot);

  try {
    await fsp.rm(check.path, { recursive: true, force: true });
  } catch (error) {
    return {
      removed: false,
      path: check.path,
      worktreesRemoved: worktrees.removed,
      worktreesPruned: worktrees.pruned,
      error: redactedErrorMessage(error, "Failed to remove the clone directory."),
    };
  }

  return {
    removed: true,
    path: check.path,
    worktreesRemoved: worktrees.removed,
    worktreesPruned: worktrees.pruned,
  };
}
