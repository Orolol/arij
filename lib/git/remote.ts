import simpleGit, { type SimpleGit } from "simple-git";
import { isSafeRepoNameSegment } from "@/lib/projects/workspace-constants";

export interface ParsedGitHubRemote {
  owner: string;
  repo: string;
  ownerRepo: string;
}

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

function normalizeRemoteUrl(raw: string): string {
  return raw.trim();
}

export function parseGitHubOwnerRepoFromRemoteUrl(
  remoteUrl: string
): ParsedGitHubRemote | null {
  const value = normalizeRemoteUrl(remoteUrl);
  if (!value) return null;

  const patterns = [
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
    /^https?:\/\/(?:www\.)?github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
    /^git:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match?.groups?.owner || !match.groups.repo) {
      continue;
    }

    const owner = match.groups.owner;
    const repo = match.groups.repo;
    if (!owner || !repo) continue;

    return {
      owner,
      repo,
      ownerRepo: `${owner}/${repo}`,
    };
  }

  return null;
}

export interface ParsedGitHubRepoInput extends ParsedGitHubRemote {
  /** Clean, credential-free HTTPS URL to clone from. */
  cloneUrl: string;
}

/**
 * Accepts anything a user might paste into the Import field and reduces it to
 * `{ owner, repo }` plus the canonical HTTPS clone URL.
 *
 * On top of the remote formats `parseGitHubOwnerRepoFromRemoteUrl` handles
 * (`git@`, `ssh://`, `https://`, `git://`) this also takes:
 *   - the shorthand `owner/repo`
 *   - browser URLs carrying a suffix: `/tree/main`, `/pull/12`, `?tab=readme`,
 *     `#readme`
 *
 * Owner and repo are re-validated against `isSafeRepoNameSegment` afterwards,
 * so a crafted input can never produce a path segment that escapes the clone
 * root. Returns null when the input is not a recognisable GitHub repository.
 */
export function parseGitHubRepoInput(
  input: string
): ParsedGitHubRepoInput | null {
  const raw = (input ?? "").trim();
  if (!raw || raw.includes("\0")) return null;

  // Query string and fragment are never part of the repository identity.
  const withoutSuffix = raw.split("#")[0].split("?")[0].trim();
  if (!withoutSuffix) return null;

  const parsed =
    parseGitHubOwnerRepoFromRemoteUrl(withoutSuffix) ??
    parseTruncatedGitHubUrl(withoutSuffix) ??
    parseOwnerRepoShorthand(withoutSuffix);

  if (!parsed) return null;

  if (
    !isSafeRepoNameSegment(parsed.owner) ||
    !isSafeRepoNameSegment(parsed.repo)
  ) {
    return null;
  }

  return {
    ...parsed,
    cloneUrl: `https://github.com/${parsed.owner}/${parsed.repo}.git`,
  };
}

/**
 * `https://github.com/owner/repo/tree/main` and friends: keep the first two
 * path segments and re-parse as a plain repository URL.
 */
function parseTruncatedGitHubUrl(value: string): ParsedGitHubRemote | null {
  const match = value.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/(?<rest>.+)$/i
  );
  const rest = match?.groups?.rest;
  if (!rest) return null;

  const segments = rest.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, repoSegment] = segments;
  const repo = repoSegment.replace(/\.git$/i, "");
  if (!owner || !repo) return null;

  return { owner, repo, ownerRepo: `${owner}/${repo}` };
}

/** The bare `owner/repo` shorthand. */
function parseOwnerRepoShorthand(value: string): ParsedGitHubRemote | null {
  const match = value.match(
    /^(?<owner>[A-Za-z0-9._-]+)\/(?<repo>[A-Za-z0-9._-]+?)(?:\.git)?$/
  );
  if (!match?.groups) return null;

  const { owner, repo } = match.groups;
  return { owner, repo, ownerRepo: `${owner}/${repo}` };
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
