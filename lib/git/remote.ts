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

export interface ParsedGitHubRepoInput extends ParsedGitHubRemote {
  /** Always normalised to https://github.com/<owner>/<repo>.git */
  cloneUrl: string;
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

/**
 * GitHub allows letters, digits, `.`, `-` and `_` in owner and repo names.
 * Anything else — separators, NUL bytes, whitespace — is rejected here so a
 * crafted URL can never reach the filesystem layer. A leading `-` is refused
 * as well: it would otherwise be read as an option by `git clone`.
 */
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

function isSafeRepoSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment.startsWith("-")) return false;
  // Rejects `.`, `..` and any embedded traversal component, matching the
  // posture of validatePath() in lib/validation/path.ts.
  if (segment === "." || segment.includes("..")) return false;
  return REPO_SEGMENT_PATTERN.test(segment);
}

function buildRepoInput(
  owner: string,
  repo: string
): ParsedGitHubRepoInput | null {
  const cleanRepo = repo.replace(/\.git$/i, "");
  if (!isSafeRepoSegment(owner) || !isSafeRepoSegment(cleanRepo)) {
    return null;
  }

  return {
    owner,
    repo: cleanRepo,
    ownerRepo: `${owner}/${cleanRepo}`,
    cloneUrl: `https://github.com/${owner}/${cleanRepo}.git`,
  };
}

/**
 * Browser URLs carry a suffix the remote-url parser does not know about:
 * `/tree/main`, `/blob/main/README.md`, `/pull/12`, `?tab=readme-ov-file`,
 * `#anchor`. Keep the first two path segments and drop the rest.
 */
function stripBrowserSuffix(value: string): string | null {
  const match = value.match(
    /^(?<base>https?:\/\/(?:www\.)?github\.com\/[^/?#]+\/[^/?#]+)[/?#]/i
  );
  return match?.groups?.base ?? null;
}

/** `owner/repo` shorthand — exactly two segments, no scheme, no host. */
function parseShorthand(value: string): ParsedGitHubRepoInput | null {
  const match = value.match(/^(?<owner>[^/]+)\/(?<repo>[^/]+?)\/?$/);
  if (!match?.groups?.owner || !match.groups.repo) return null;
  return buildRepoInput(match.groups.owner, match.groups.repo);
}

/**
 * Parses every GitHub repo reference a user is likely to paste — remote URLs
 * (https, ssh, git), browser URLs with trailing segments, and the `owner/repo`
 * shorthand — into a normalised clone target. Returns null for anything that
 * is not a GitHub repository or whose owner/repo fails strict validation.
 */
export function parseGitHubRepoInput(
  input: string
): ParsedGitHubRepoInput | null {
  if (typeof input !== "string") return null;

  const value = input.trim();
  if (!value || value.includes("\0")) return null;

  // `github.com/owner/repo` pasted without a scheme.
  const withScheme = /^(?:www\.)?github\.com\//i.test(value)
    ? `https://${value}`
    : value;

  for (const candidate of [withScheme, stripBrowserSuffix(withScheme)]) {
    if (!candidate) continue;
    const parsed = parseGitHubOwnerRepoFromRemoteUrl(candidate);
    if (!parsed) continue;
    // A `?query` or `#anchor` is swallowed by the remote parser's `[^/]+?`
    // repo group, so a rejected candidate falls through to the stripped one
    // rather than failing the whole parse.
    const result = buildRepoInput(parsed.owner, parsed.repo);
    if (result) return result;
  }

  // A github.com URL that did not parse is not a repo reference; do not fall
  // through to the shorthand rule and mis-read the host as an owner.
  if (withScheme !== value) return null;

  return parseShorthand(value);
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
