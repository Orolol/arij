import simpleGit, { type SimpleGit } from "simple-git";
import { parseGitHubOwnerRepoFromRemoteUrl } from "./remote-parse";

// The pure parsing layer lives in ./remote-parse so the browser can use it
// (this module pulls in simple-git). Re-exported here so server-side callers
// keep a single import site.
export {
  normalizeRemoteUrl,
  parseGitHubOwnerRepoFromRemoteUrl,
  parseGitHubRepoInput,
} from "./remote-parse";
export type {
  ParsedGitHubRemote,
  ParsedGitHubRepoInput,
} from "./remote-parse";

import type { ParsedGitHubRemote } from "./remote-parse";

export interface DetectedGitHubRemote extends ParsedGitHubRemote {
  remoteName: string;
  remoteUrl: string;
}

export interface BranchSyncStatus {
  branch: string;
  remote: string;
  remoteBranch: string;
  ahead: number;
  behind: number;
  hasRemoteBranch: boolean;
}

export interface PullWithConflictResult {
  conflicted: boolean;
  summary: string;
  conflictedFiles: string[];
}

export class PushValidationError extends Error {
  readonly code: "working_tree_dirty" | "branch_behind_remote";

  constructor(
    code: "working_tree_dirty" | "branch_behind_remote",
    message: string
  ) {
    super(message);
    this.name = "PushValidationError";
    this.code = code;
  }
}

function getGit(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

function defaultRemote(remote?: string): string {
  return remote?.trim() || "origin";
}

export async function detectGitHubRemote(
  repoPath: string
): Promise<DetectedGitHubRemote | null> {
  const git = getGit(repoPath);
  const remotes = await git.getRemotes(true);
  if (remotes.length === 0) return null;

  const prioritized = [
    ...remotes.filter((remote) => remote.name === "origin"),
    ...remotes.filter((remote) => remote.name !== "origin"),
  ];

  for (const remote of prioritized) {
    const remoteUrl =
      remote.refs?.fetch || remote.refs?.push || "";
    const parsed = parseGitHubOwnerRepoFromRemoteUrl(remoteUrl);
    if (!parsed) continue;

    return {
      ...parsed,
      remoteName: remote.name,
      remoteUrl,
    };
  }

  return null;
}

export async function fetchGitRemote(
  repoPath: string,
  remote = "origin"
) {
  const git = getGit(repoPath);
  return git.fetch(defaultRemote(remote));
}

export async function pullGitBranchWithConflictSupport(
  repoPath: string,
  branch: string,
  remote = "origin"
): Promise<PullWithConflictResult> {
  const cleanBranch = branch.trim();
  if (!cleanBranch) {
    throw new Error("Branch is required for pull.");
  }

  const git = getGit(repoPath);
  try {
    const pullResult = await git.pull(defaultRemote(remote), cleanBranch);
    return {
      conflicted: false,
      summary: pullResult.summary
        ? JSON.stringify(pullResult.summary)
        : "Pulled successfully.",
      conflictedFiles: [],
    };
  } catch (error) {
    const status = await git.status();
    if (status.conflicted.length > 0) {
      return {
        conflicted: true,
        summary: error instanceof Error ? error.message : "Merge conflicts detected.",
        conflictedFiles: status.conflicted,
      };
    }
    throw error;
  }
}

export async function pushGitBranch(
  repoPath: string,
  branch: string,
  remote = "origin",
  setUpstream = true
) {
  const cleanBranch = branch.trim();
  if (!cleanBranch) {
    throw new Error("Branch is required for push.");
  }

  const git = getGit(repoPath);
  const options = setUpstream ? ["--set-upstream"] : [];
  return git.push(defaultRemote(remote), cleanBranch, options);
}

export async function validatePushPreconditions(
  repoPath: string,
  branch: string,
  remote = "origin"
): Promise<void> {
  const git = getGit(repoPath);
  const status = await git.status();
  const hasChanges =
    status.files.length > 0 ||
    status.staged.length > 0 ||
    status.not_added.length > 0;
  if (hasChanges) {
    throw new PushValidationError(
      "working_tree_dirty",
      "Push rejected: working tree has uncommitted changes."
    );
  }

  const sync = await getBranchSyncStatus(repoPath, branch, remote);
  if (sync.behind > 0) {
    throw new PushValidationError(
      "branch_behind_remote",
      `Push rejected: local branch is ${sync.behind} commit(s) behind ${sync.remoteBranch}. Pull first.`
    );
  }
}

export async function getConflictFileDiffs(
  repoPath: string,
  files: string[]
): Promise<Array<{ filePath: string; diff: string }>> {
  const git = getGit(repoPath);
  const diffs: Array<{ filePath: string; diff: string }> = [];
  for (const file of files) {
    const diff = await git.raw(["diff", "--", file]);
    diffs.push({ filePath: file, diff });
  }
  return diffs;
}

/**
 * The branch `origin` advertises as its default — `main`, but just as often
 * `trunk`, `develop` or `dev`. Read from the `origin/HEAD` symbolic ref that
 * `git clone` writes.
 *
 * Returns null when the repository has no remote, or when the remote never
 * advertised a HEAD. Callers pick their own fallback from there: "no remote"
 * means something different to a fresh clone than it does to a merge.
 */
export async function resolveRemoteDefaultBranch(
  repoPath: string,
  remote = "origin"
): Promise<string | null> {
  const cleanRemote = defaultRemote(remote);

  try {
    const ref = await getGit(repoPath).raw([
      "symbolic-ref",
      "--quiet",
      "--short",
      `refs/remotes/${cleanRemote}/HEAD`,
    ]);

    const value = ref?.trim() ?? "";
    const prefix = `${cleanRemote}/`;
    const branch = value.startsWith(prefix) ? value.slice(prefix.length) : value;
    return branch || null;
  } catch {
    return null;
  }
}

export async function getCurrentGitBranch(repoPath: string): Promise<string> {
  const git = getGit(repoPath);
  const branches = await git.branchLocal();
  return branches.current;
}

async function hasBranch(git: SimpleGit, branchName: string): Promise<boolean> {
  try {
    await git.revparse([branchName]);
    return true;
  } catch {
    return false;
  }
}

export async function getBranchSyncStatus(
  repoPath: string,
  branch: string,
  remote = "origin"
): Promise<BranchSyncStatus> {
  const cleanBranch = branch.trim();
  if (!cleanBranch) {
    throw new Error("Branch is required for status.");
  }

  const cleanRemote = defaultRemote(remote);
  const remoteBranch = `${cleanRemote}/${cleanBranch}`;
  const git = getGit(repoPath);

  const hasLocalBranch = await hasBranch(git, cleanBranch);
  if (!hasLocalBranch) {
    throw new Error(`Local branch '${cleanBranch}' was not found.`);
  }

  const hasRemoteBranch = await hasBranch(git, remoteBranch);
  if (!hasRemoteBranch) {
    return {
      branch: cleanBranch,
      remote: cleanRemote,
      remoteBranch,
      ahead: 0,
      behind: 0,
      hasRemoteBranch: false,
    };
  }

  const raw = await git.raw([
    "rev-list",
    "--left-right",
    "--count",
    `${cleanBranch}...${remoteBranch}`,
  ]);

  const [aheadRaw, behindRaw] = raw.trim().split(/\s+/);
  return {
    branch: cleanBranch,
    remote: cleanRemote,
    remoteBranch,
    ahead: Number.parseInt(aheadRaw ?? "0", 10) || 0,
    behind: Number.parseInt(behindRaw ?? "0", 10) || 0,
    hasRemoteBranch: true,
  };
}
