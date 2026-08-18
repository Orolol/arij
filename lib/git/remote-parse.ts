/**
 * Pure parsing of GitHub repository references.
 *
 * Split out of lib/git/remote.ts — which imports `simple-git` and therefore
 * cannot be bundled for the browser — so the import page can validate what the
 * user pastes with the exact same rules the clone route applies server-side.
 * Same pattern as lib/projects/workspace-constants.ts: no db, no node builtins,
 * no I/O of any kind.
 *
 * lib/git/remote.ts re-exports everything here, so server code keeps importing
 * from a single place.
 */

export interface ParsedGitHubRemote {
  owner: string;
  repo: string;
  ownerRepo: string;
}

export interface ParsedGitHubRepoInput extends ParsedGitHubRemote {
  /** Always normalised to https://github.com/<owner>/<repo>.git */
  cloneUrl: string;
}

export function normalizeRemoteUrl(raw: string): string {
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
