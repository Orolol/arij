import simpleGit, { type SimpleGit } from "simple-git";

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

/** Owner/repo plus the clean HTTPS URL Arij clones from. */
export interface ParsedGitHubRepoInput extends ParsedGitHubRemote {
  /** `https://github.com/<owner>/<repo>.git` — never carries credentials. */
  cloneUrl: string;
}

/** Characters GitHub allows in an owner or repository name. */
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function isSafeSegment(value: string): boolean {
  if (!GITHUB_NAME_PATTERN.test(value)) return false;
  // `.` / `..` pass the character class but would escape the clone root.
  return value !== "." && value !== "..";
}

/**
 * Parses anything a user may paste into the import field:
 *
 *   - every remote form `parseGitHubOwnerRepoFromRemoteUrl()` handles
 *     (`git@`, `ssh://`, `https://`, `git://`)
 *   - the `owner/repo` shorthand
 *   - browser URLs carrying a suffix (`/tree/main`, `/pull/12`, `?tab=readme`)
 *
 * Owner and repo are re-validated against GitHub's character set and rejected
 * when they are `.` or `..`, so a crafted input can never escape the clone
 * root. Returns null for anything that is not a GitHub repository reference.
 */
export function parseGitHubRepoInput(
  input: string
): ParsedGitHubRepoInput | null {
  const value = normalizeRemoteUrl(input);
  if (!value || value.includes("\0")) return null;

  // Tried in order, and a candidate that fails validation falls through to
  // the next: `https://github.com/o/r?tab=readme` parses as a remote URL with
  // the query glued to the repo name, and only the browser form gets it right.
  const candidates = [
    parseGitHubOwnerRepoFromRemoteUrl(value),
    parseGitHubBrowserUrl(value),
    parseOwnerRepoShorthand(value),
  ];

  for (const parsed of candidates) {
    if (!parsed) continue;

    const repo = parsed.repo.replace(/\.git$/i, "");
    if (!isSafeSegment(parsed.owner) || !isSafeSegment(repo)) continue;

    return {
      owner: parsed.owner,
      repo,
      ownerRepo: `${parsed.owner}/${repo}`,
      cloneUrl: `https://github.com/${parsed.owner}/${repo}.git`,
    };
  }

  return null;
}

/** `https://github.com/owner/repo/tree/main`, `.../pull/12`, `...?tab=readme`. */
function parseGitHubBrowserUrl(value: string): ParsedGitHubRemote | null {
  const match = value.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/(?<owner>[^/?#]+)\/(?<repo>[^/?#]+)(?:[/?#].*)?$/i
  );
  if (!match?.groups?.owner || !match.groups.repo) return null;

  const owner = match.groups.owner;
  const repo = match.groups.repo.replace(/\.git$/i, "");
  return { owner, repo, ownerRepo: `${owner}/${repo}` };
}

/** Bare `owner/repo` shorthand — no host, no scheme. */
function parseOwnerRepoShorthand(value: string): ParsedGitHubRemote | null {
  const match = value.match(
    /^(?<owner>[^/\s:@]+)\/(?<repo>[^/\s:@]+?)(?:\.git)?\/?$/
  );
  if (!match?.groups?.owner || !match.groups.repo) return null;

  const owner = match.groups.owner;
  const repo = match.groups.repo;
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
