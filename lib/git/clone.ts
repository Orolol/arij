import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import {
  parseGitHubOwnerRepoFromRemoteUrl,
  parseGitHubRepoInput,
  type ParsedGitHubRepoInput,
} from "./remote";
import { redactGitCredentials, redactedErrorMessage } from "./redact";

/**
 * Cloning a GitHub repository into the app-managed workspace.
 *
 * Two properties matter more than anything else here:
 *
 *  1. **The token never touches the disk.** It is passed as a one-shot
 *     `-c http.extraHeader=...` on the command line, so `origin` keeps the
 *     clean URL and `.git/config` never learns the secret. Every error string
 *     leaving this module is redacted (git echoes the failing command).
 *
 *  2. **Re-running an import is cheap and safe.** A destination that already
 *     holds a healthy clone of the same repository is *reused* (fetch only),
 *     which is what makes recovery from an interrupted import instant. A
 *     destination holding a clone of a *different* repository is a conflict and
 *     is never overwritten. A destination holding the debris of an interrupted
 *     clone is neither — it is Arij's own leftover, and is replaced.
 */

/** How an existing destination directory was classified before we acted on it. */
export type CloneDestinationState =
  | "absent"
  | "empty"
  | "healthy_match"
  | "remote_mismatch"
  | "partial_clone";

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
  /** What we found on disk before acting — surfaced for logs and tests. */
  destinationState: CloneDestinationState;
  durationMs: number;
}

export class CloneConflictError extends Error {
  readonly code = "clone_destination_conflict";
  readonly destination: string;
  readonly existingRemote: string | null;

  constructor(destination: string, existingRemote: string | null) {
    super(
      existingRemote
        ? `${destination} already contains a clone of ${existingRemote}.`
        : `${destination} already exists and is not an Arij clone.`
    );
    this.name = "CloneConflictError";
    this.destination = destination;
    this.existingRemote = existingRemote;
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
 * `remote_mismatch` is the only state that becomes a user-facing conflict.
 * `partial_clone` covers both "not a git repository at all" and "a git
 * repository with no HEAD / no origin": in an Arij-owned root at a name Arij
 * chose, that is debris from an interrupted run, not somebody's work.
 */
export async function classifyCloneDestination(
  destination: string,
  expected: { owner: string; repo: string }
): Promise<{ state: CloneDestinationState; existingRemote: string | null }> {
  if (!fs.existsSync(destination)) {
    return { state: "absent", existingRemote: null };
  }

  if (await isEmptyDirectory(destination)) {
    return { state: "empty", existingRemote: null };
  }

  const originUrl = await readOriginUrl(destination);
  if (!originUrl) {
    return { state: "partial_clone", existingRemote: null };
  }

  const parsed = parseGitHubOwnerRepoFromRemoteUrl(originUrl);
  const matches =
    parsed !== null &&
    parsed.owner.toLowerCase() === expected.owner.toLowerCase() &&
    parsed.repo.toLowerCase() === expected.repo.toLowerCase();

  if (!matches) {
    return {
      state: "remote_mismatch",
      existingRemote: parsed?.ownerRepo ?? redactGitCredentials(originUrl),
    };
  }

  if (!(await hasCheckedOutHead(destination))) {
    return { state: "partial_clone", existingRemote: parsed.ownerRepo };
  }

  return { state: "healthy_match", existingRemote: parsed.ownerRepo };
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

/** Best-effort removal of a directory we are about to replace or gave up on. */
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
 * Throws {@link CloneConflictError} when the destination holds a clone of a
 * different repository, and {@link CloneFailedError} for every git failure.
 * A clone that fails part-way is deleted, so the debris can never be mistaken
 * for a matching repository on the next attempt.
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

  const startedAt = Date.now();
  const { state, existingRemote } = await classifyCloneDestination(
    destination,
    parsed
  );

  if (state === "remote_mismatch") {
    throw new CloneConflictError(destination, existingRemote);
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
      destinationState: state,
      durationMs: Date.now() - startedAt,
    };
  }

  // `empty` and `partial_clone` both mean "Arij's own leftover": clear it so
  // git has a clean destination, then download.
  if (state !== "absent") {
    await discard(destination);
  }

  try {
    await runClone(parsed.cloneUrl, destination, token);
  } catch (error) {
    await discard(destination);
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
    destinationState: state,
    durationMs: Date.now() - startedAt,
  };
}
