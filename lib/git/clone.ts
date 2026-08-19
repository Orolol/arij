import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import simpleGit, { type SimpleGit } from "simple-git";
import {
  parseGitHubOwnerRepoFromRemoteUrl,
  parseGitHubRepoInput,
  type ParsedGitHubRepoInput,
} from "./remote";
import { redactGitCredentials, redactedErrorMessage } from "./redact";
import { withPathLock } from "./clone-lock";
import {
  hasCloneMarkerFor,
  isArijManagedClone,
  writeCloneMarker,
} from "./clone-marker";

/**
 * Cloning a GitHub repository into the app-managed workspace.
 *
 * Three properties matter more than anything else here:
 *
 *  1. **The token never touches the disk.** It is passed as a one-shot
 *     `-c http.extraHeader=...` on the command line, so `origin` keeps the
 *     clean URL and `.git/config` never learns the secret. Every error string
 *     leaving this module is redacted (git echoes the failing command).
 *
 *  2. **The destination is never destroyed.** The download runs into a
 *     temporary sibling directory and is moved into place with a single
 *     `rename` once it is complete and stamped. A destination that already
 *     holds something Arij cannot positively identify as its own is a conflict,
 *     reported to the user — never cleaned up on their behalf. The only
 *     directory this module ever deletes is one it created itself.
 *
 *     That also makes an interrupted clone a non-event: the debris is in the
 *     temp directory, so the destination is either absent (clone again) or a
 *     complete clone (reuse it). There is no half-clone state to recover from.
 *
 *  3. **Re-running an import is cheap.** A destination that already holds a
 *     healthy clone of the same repository is *reused* (fetch only), which is
 *     what makes recovery from an interrupted import instant.
 */

/** Prefix of the staging directories this module creates inside the root. */
const TEMP_CLONE_PREFIX = ".arij-clone-tmp-";

/** How an existing destination directory was classified before we acted on it. */
export type CloneDestinationState =
  | "absent"
  | "empty"
  | "healthy_match"
  | "remote_mismatch"
  /** A broken clone carrying Arij's marker — provably ours, safe to replace. */
  | "arij_debris"
  /** Anything Arij cannot prove it created. Always a conflict, never deleted. */
  | "foreign_content";

export interface CloneRepoResult {
  /** Absolute path of the clone. */
  path: string;
  owner: string;
  repo: string;
  ownerRepo: string;
  /** Clean, credential-free URL recorded as `origin`. */
  remoteUrl: string;
  defaultBranch: string;
  /** True when an existing clone was fetched instead of re-downloaded. */
  reused: boolean;
  /**
   * True when the directory carries Arij's marker, i.e. Arij created it and may
   * later delete it. False for a pre-existing clone Arij merely reused — those
   * belong to the user.
   */
  managed: boolean;
  /** What we found on disk before acting — surfaced for logs and tests. */
  destinationState: CloneDestinationState;
  durationMs: number;
}

export class CloneConflictError extends Error {
  readonly code = "clone_destination_conflict";
  readonly destination: string;
  readonly existingRemote: string | null;
  readonly state: CloneDestinationState;

  constructor(
    destination: string,
    existingRemote: string | null,
    state: CloneDestinationState = "foreign_content"
  ) {
    super(
      existingRemote
        ? `${destination} already contains a clone of ${existingRemote}. Arij will not modify it — remove it or change the projects root.`
        : `${destination} already exists and was not created by Arij. Arij will not modify it — remove it or change the projects root.`
    );
    this.name = "CloneConflictError";
    this.destination = destination;
    this.existingRemote = existingRemote;
    this.state = state;
  }
}

export class CloneFailedError extends Error {
  readonly code = "clone_failed";

  constructor(message: string) {
    super(redactGitCredentials(message));
    this.name = "CloneFailedError";
  }
}

/**
 * `Authorization: Basic base64("x-access-token:<pat>")` — GitHub's documented
 * way of authenticating HTTPS git traffic with a PAT.
 */
export function buildAuthHeaderConfig(token: string): string {
  const encoded = Buffer.from(`x-access-token:${token.trim()}`).toString(
    "base64"
  );
  return `http.extraHeader=Authorization: Basic ${encoded}`;
}

/** Prefixes git args with the credential config when a token is available. */
function withAuth(token: string | null | undefined, args: string[]): string[] {
  const clean = token?.trim();
  if (!clean) return args;
  return ["-c", buildAuthHeaderConfig(clean), ...args];
}

async function isEmptyDirectory(dir: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(dir);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function readOriginUrl(repoPath: string): Promise<string | null> {
  try {
    const remotes = await simpleGit(repoPath).getRemotes(true);
    const origin =
      remotes.find((remote) => remote.name === "origin") ?? remotes[0];
    const url = origin?.refs?.fetch || origin?.refs?.push || "";
    return url.trim() || null;
  } catch {
    return null;
  }
}

/**
 * A clone is healthy when git recognises it *and* it has a commit checked out.
 * A directory whose `.git` exists but whose HEAD is unborn is the signature of
 * a clone that died mid-transfer.
 */
async function hasCheckedOutHead(repoPath: string): Promise<boolean> {
  try {
    const git = simpleGit(repoPath);
    await git.raw(["rev-parse", "--git-dir"]);
    await git.raw(["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classifies what is sitting at the destination.
 *
 * The default answer for anything occupied is `foreign_content`: a conflict the
 * user is told about. Only two states let the clone proceed over existing
 * content — `healthy_match`, which is reused without modification, and
 * `arij_debris`, a broken clone that still carries Arij's own marker and is
 * therefore provably not the user's work.
 */
export async function classifyCloneDestination(
  destination: string,
  expected: { owner: string; repo: string }
): Promise<{ state: CloneDestinationState; existingRemote: string | null }> {
  if (!fs.existsSync(destination)) {
    return { state: "absent", existingRemote: null };
  }

  if (!fs.statSync(destination).isDirectory()) {
    return { state: "foreign_content", existingRemote: null };
  }

  if (await isEmptyDirectory(destination)) {
    return { state: "empty", existingRemote: null };
  }

  const originUrl = await readOriginUrl(destination);
  const parsed = originUrl ? parseGitHubOwnerRepoFromRemoteUrl(originUrl) : null;
  const remoteMatches =
    parsed !== null &&
    parsed.owner.toLowerCase() === expected.owner.toLowerCase() &&
    parsed.repo.toLowerCase() === expected.repo.toLowerCase();

  // A complete clone of the repository we were asked for: reuse it. This is
  // non-destructive, so it does not require the marker — a checkout the user
  // made by hand is just as reusable, it simply stays theirs.
  if (remoteMatches && (await hasCheckedOutHead(destination))) {
    return { state: "healthy_match", existingRemote: parsed.ownerRepo };
  }

  // Everything below is only reachable by replacing what is there, so it takes
  // proof of ownership rather than a heuristic.
  if (hasCloneMarkerFor(destination, expected)) {
    return {
      state: "arij_debris",
      existingRemote: parsed?.ownerRepo ?? null,
    };
  }

  if (originUrl && !remoteMatches) {
    return {
      state: "remote_mismatch",
      existingRemote: parsed?.ownerRepo ?? redactGitCredentials(originUrl),
    };
  }

  return { state: "foreign_content", existingRemote: parsed?.ownerRepo ?? null };
}

/**
 * Branch the clone checked out. Falls back to `origin/HEAD` and finally to
 * `main`, so the caller always gets a usable name.
 */
export async function detectDefaultBranch(repoPath: string): Promise<string> {
  // simple-git throws *synchronously* from its factory when the directory does
  // not exist, so the instance is built inside the guard like every call below.
  const readRef = async (args: string[]): Promise<string | null> => {
    try {
      return (await simpleGit(repoPath).raw(args)).trim();
    } catch {
      return null;
    }
  };

  const current = await readRef(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current && current !== "HEAD") return current;

  const symbolic = await readRef([
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (symbolic?.startsWith("origin/")) return symbolic.slice("origin/".length);

  return "main";
}

async function runClone(
  cloneUrl: string,
  destination: string,
  token: string | null | undefined
): Promise<void> {
  const parent = path.dirname(destination);
  await fsp.mkdir(parent, { recursive: true });

  // simple-git needs an existing baseDir; the parent is guaranteed above.
  const git: SimpleGit = simpleGit(parent);

  // Full clone on purpose: worktrees, merge-base and tagging all need the real
  // history, so no `--depth` and no `--single-branch`.
  await git.raw(withAuth(token, ["clone", cloneUrl, destination]));
}

async function runFetch(
  repoPath: string,
  token: string | null | undefined
): Promise<void> {
  await simpleGit(repoPath).raw(withAuth(token, ["fetch", "origin", "--prune"]));
}

/** Best-effort removal of a directory this module created. */
async function discard(directory: string): Promise<void> {
  try {
    await fsp.rm(directory, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      "[clone] failed to remove directory",
      directory,
      redactedErrorMessage(error)
    );
  }
}

/** Staging directory for one download, a sibling of the destination. */
function tempCloneDir(destination: string): string {
  const resolved = path.resolve(destination);
  return path.join(
    path.dirname(resolved),
    `${TEMP_CLONE_PREFIX}${path.basename(resolved)}-${randomUUID().slice(0, 8)}`
  );
}

/**
 * Removes staging directories abandoned by an earlier attempt at this
 * destination.
 *
 * Safe by construction, and only because of the two facts that bracket it: the
 * name is one only this module generates, and the caller holds the destination
 * lock — so no live attempt at this destination can own one.
 */
async function sweepStaleTempDirs(destination: string): Promise<void> {
  const resolved = path.resolve(destination);
  const parent = path.dirname(resolved);
  const prefix = `${TEMP_CLONE_PREFIX}${path.basename(resolved)}-`;

  let entries: string[];
  try {
    entries = await fsp.readdir(parent);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      await discard(path.join(parent, entry));
    }
  }
}

/**
 * Moves a finished clone onto the destination.
 *
 * `rename` is atomic, so the destination goes from "absent" to "a complete,
 * stamped clone" with no observable state in between — which is what removes
 * the half-clone recovery problem entirely.
 */
async function swapIntoPlace(
  temp: string,
  destination: string,
  state: CloneDestinationState
): Promise<void> {
  if (state === "arij_debris") {
    // Proven ours by the marker; the only replace path that exists.
    await fsp.rm(destination, { recursive: true, force: true });
  } else if (state === "empty") {
    // rename(2) replaces an empty directory on Linux, but not on every
    // platform; removing it first keeps the behaviour identical everywhere.
    await fsp.rmdir(destination).catch(() => {});
  }

  await fsp.rename(temp, destination);
}

export interface CloneGitHubRepositoryOptions {
  /** Anything the user pasted: URL, SSH remote, or `owner/repo`. */
  input: string;
  /** Absolute destination, already resolved inside the projects root. */
  destination: string;
  /** GitHub PAT from settings; omit for public repositories. */
  token?: string | null;
}

/**
 * Clones (or reuses) a GitHub repository at `destination`.
 *
 * Throws {@link CloneConflictError} when the destination holds anything other
 * than a healthy clone of the requested repository, and {@link CloneFailedError}
 * for every git failure. Concurrent calls for the same destination are
 * serialised, so the second one observes the first one's result rather than
 * racing it.
 */
export async function cloneGitHubRepository({
  input,
  destination,
  token,
}: CloneGitHubRepositoryOptions): Promise<CloneRepoResult> {
  const parsed: ParsedGitHubRepoInput | null = parseGitHubRepoInput(input);
  if (!parsed) {
    throw new CloneFailedError(
      `"${input}" is not a GitHub repository. Use https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo.`
    );
  }

  return withPathLock(destination, () =>
    performClone(parsed, destination, token)
  );
}

async function performClone(
  parsed: ParsedGitHubRepoInput,
  destination: string,
  token: string | null | undefined
): Promise<CloneRepoResult> {
  const startedAt = Date.now();
  const { state, existingRemote } = await classifyCloneDestination(
    destination,
    parsed
  );

  if (state === "remote_mismatch" || state === "foreign_content") {
    throw new CloneConflictError(destination, existingRemote, state);
  }

  // Reuse: the expensive download already happened. This is the path an
  // interrupted import takes on retry — a fetch, then straight to analysis.
  if (state === "healthy_match") {
    try {
      await runFetch(destination, token);
    } catch (error) {
      // A failing fetch must not sink a usable clone (offline, expired token):
      // the working tree is still valid and analysis can proceed.
      console.warn(
        "[clone] reuse fetch failed, continuing with existing clone:",
        redactedErrorMessage(error)
      );
    }

    return {
      path: destination,
      owner: parsed.owner,
      repo: parsed.repo,
      ownerRepo: parsed.ownerRepo,
      remoteUrl: parsed.cloneUrl,
      defaultBranch: await detectDefaultBranch(destination),
      reused: true,
      // A clone Arij did not create stays the user's, however convenient the
      // path is. Only the marker grants deletion rights.
      managed: isArijManagedClone(destination),
      destinationState: state,
      durationMs: Date.now() - startedAt,
    };
  }

  await sweepStaleTempDirs(destination);
  const temp = tempCloneDir(destination);

  let managed: boolean;
  try {
    await runClone(parsed.cloneUrl, temp, token);
    // Stamped before the swap, so the destination is never observable as an
    // unmarked Arij clone.
    managed = await writeCloneMarker(temp, {
      owner: parsed.owner,
      repo: parsed.repo,
      ownerRepo: parsed.ownerRepo,
      remoteUrl: parsed.cloneUrl,
    });
    await swapIntoPlace(temp, destination, state);
  } catch (error) {
    await discard(temp);
    throw new CloneFailedError(
      redactedErrorMessage(error, `Failed to clone ${parsed.ownerRepo}.`)
    );
  }

  return {
    path: destination,
    owner: parsed.owner,
    repo: parsed.repo,
    ownerRepo: parsed.ownerRepo,
    remoteUrl: parsed.cloneUrl,
    defaultBranch: await detectDefaultBranch(destination),
    reused: false,
    managed,
    destinationState: state,
    durationMs: Date.now() - startedAt,
  };
}
