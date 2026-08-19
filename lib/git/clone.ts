import fs from "node:fs";
import path from "node:path";
import simpleGit, { CheckRepoActions, type SimpleGit } from "simple-git";
import {
  detectGitHubRemote,
  getCurrentGitBranch,
  resolveRemoteDefaultBranch,
} from "./remote";
import { DEFAULT_CLONE_TIMEOUT_MS } from "./clone-constants";

/**
 * Git clone service.
 *
 * Clones a repository into an app-managed directory, authenticating with the
 * PAT stored in settings when one is available. Three invariants drive the
 * implementation:
 *
 *  1. **Full clones only.** No `--depth`, no `--single-branch`: Arij creates
 *     worktrees off `main`, merges epic branches and tags releases, all of
 *     which need complete history.
 *  2. **The token never touches disk.** It is passed as an `http.extraHeader`
 *     via `-c`, so it stays out of `.git/config` and `origin` keeps the clean
 *     URL — `fetch`/`pull`/`push` afterwards behave like a hand-made clone.
 *  3. **Nothing existing is ever destroyed.** A destination that already holds
 *     the same repository is reused (fetch only); anything else is a conflict.
 *     Only a directory this service created is removed, and only when its own
 *     clone failed.
 */

export type CloneErrorCode =
  | "invalid_input"
  | "conflict"
  | "not_found"
  | "auth_failed"
  | "network"
  | "branch_not_found"
  | "timeout"
  | "clone_failed";

export class CloneError extends Error {
  readonly code: CloneErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: CloneErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CloneError";
    this.code = code;
    this.details = details;
  }
}

export interface CloneRepositoryOptions {
  /** Clean HTTPS (or, in tests, `file://`) URL. Never carries credentials. */
  cloneUrl: string;
  /** Absolute destination directory — `<projects_root>/<owner>-<repo>`. */
  dest: string;
  /** Optional branch to check out instead of the remote's default. */
  branch?: string | null;
  /** GitHub PAT, injected as an Authorization header for this command only. */
  token?: string | null;
  /**
   * `owner/repo` an existing destination must already point at to be reused.
   * When omitted, reuse falls back to comparing `origin` with `cloneUrl`.
   */
  expectedOwnerRepo?: string | null;
  /** Wall-clock budget; the clone is aborted past it. */
  timeoutMs?: number;
}

export interface CloneRepositoryResult {
  /** Absolute path of the clone — becomes `projects.git_repo_path`. */
  path: string;
  /** Branch checked out in the clone. */
  defaultBranch: string;
  /** True when an existing clone of the same repo was fetched instead. */
  reused: boolean;
  durationMs: number;
}

const REDACTED = "[REDACTED]";

/**
 * Strips credentials from a git error before it reaches the UI, a log line or
 * `git_sync_log`. Covers the header this service injects (`Basic <base64>`),
 * URL userinfo (`https://user:pass@host`), and raw GitHub token shapes, plus
 * any exact secret the caller passes in.
 */
export function redactGitError(value: unknown, secrets: string[] = []): string {
  let text =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value == null
          ? ""
          : String(value);

  for (const secret of secrets) {
    const clean = secret?.trim();
    if (!clean) continue;
    text = text.split(clean).join(REDACTED);
  }

  return text
    // `-c http.extraHeader=Authorization: Basic ...` — everything after the
    // key is ours and secret, so drop the rest of the line wholesale.
    .replace(/(http\.extraheader=)[^\n]*/gi, `$1${REDACTED}`)
    .replace(/(\bbasic\s+)[A-Za-z0-9+/=_-]+/gi, `$1${REDACTED}`)
    .replace(/(\bbearer\s+)[A-Za-z0-9._-]+/gi, `$1${REDACTED}`)
    // `https://user:token@github.com/...`
    .replace(/:\/\/[^/\s@]+@/g, `://${REDACTED}@`)
    // Raw PAT shapes, in case git echoes one we never injected.
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, REDACTED)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, REDACTED);
}

/* ------------------------------------------------------------------ */
/* Destination serialization                                           */
/* ------------------------------------------------------------------ */

/**
 * One clone at a time per destination. Two concurrent imports of the same
 * repository would otherwise race: both see an empty destination, both clone
 * into it, and the loser corrupts the winner's work tree. The second caller
 * waits and then takes the reuse path.
 */
const destinationLocks = new Map<string, Promise<void>>();

async function withDestinationLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = destinationLocks.get(key) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => gate);
  destinationLocks.set(key, chained);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (destinationLocks.get(key) === chained) {
      destinationLocks.delete(key);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Clone                                                               */
/* ------------------------------------------------------------------ */

export async function cloneRepository(
  options: CloneRepositoryOptions
): Promise<CloneRepositoryResult> {
  const cloneUrl = options.cloneUrl?.trim() ?? "";
  const branch = options.branch?.trim() || null;

  if (!cloneUrl) {
    throw new CloneError("invalid_input", "A clone URL is required.");
  }
  if (!options.dest?.trim()) {
    throw new CloneError("invalid_input", "A destination path is required.");
  }
  // A leading dash would be read by git as an option, not a value.
  if (cloneUrl.startsWith("-")) {
    throw new CloneError("invalid_input", "Clone URL is not a valid remote.");
  }
  if (branch?.startsWith("-")) {
    throw new CloneError("invalid_input", `Invalid branch name: ${branch}`);
  }

  const dest = path.resolve(options.dest);

  return withDestinationLock(dest, () =>
    runClone({ ...options, cloneUrl, branch, dest })
  );
}

async function runClone(
  options: CloneRepositoryOptions & { dest: string; branch: string | null }
): Promise<CloneRepositoryResult> {
  const { cloneUrl, dest, branch, token } = options;
  const startedAt = Date.now();

  if (fs.existsSync(dest)) {
    return reuseExistingClone(options, startedAt);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const timeoutMs = options.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const git = simpleGit({
      baseDir: path.dirname(dest),
      abort: controller.signal,
    }).env(nonInteractiveEnv());

    await git.raw(buildCloneArgs({ cloneUrl, dest, branch, token }));

    // An explicitly requested branch is what got checked out, so it is the
    // base the caller asked for; otherwise ask the remote what its default is.
    const defaultBranch = branch ?? (await resolveDefaultBranch(dest));
    return {
      path: dest,
      defaultBranch,
      reused: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    // The directory is ours (it did not exist a moment ago) and the clone
    // failed, so a half-written tree must not survive to be "reused" later.
    removeFailedClone(dest);

    if (controller.signal.aborted) {
      throw new CloneError(
        "timeout",
        `Clone aborted after ${Math.round(timeoutMs / 1000)}s. The repository may be very large or the connection stalled — raise the clone timeout or retry.`,
        { timeoutMs }
      );
    }
    throw toCloneError(error, { cloneUrl, branch, token });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A destination that already exists is never overwritten: either it holds the
 * requested repository (fetch and reuse) or the caller gets a conflict naming
 * what is in the way.
 */
async function reuseExistingClone(
  options: CloneRepositoryOptions & { dest: string; branch: string | null },
  startedAt: number
): Promise<CloneRepositoryResult> {
  const { dest, cloneUrl, expectedOwnerRepo, token } = options;

  if (!fs.statSync(dest).isDirectory()) {
    throw new CloneError(
      "conflict",
      `${dest} already exists and is not a directory.`,
      { path: dest }
    );
  }

  if (!(await isRepositoryRoot(dest))) {
    throw new CloneError(
      "conflict",
      `${dest} already exists and is not a git repository. Move or remove it, then retry.`,
      { path: dest }
    );
  }

  const remote = await detectGitHubRemote(dest).catch(() => null);
  const originUrl = remote?.remoteUrl ?? (await readOriginUrl(dest));
  const matchesOwnerRepo =
    !!expectedOwnerRepo &&
    !!remote &&
    remote.ownerRepo.toLowerCase() === expectedOwnerRepo.toLowerCase();
  const matchesUrl =
    !!originUrl && sameRemote(originUrl, cloneUrl);

  if (!matchesOwnerRepo && !matchesUrl) {
    throw new CloneError(
      "conflict",
      `${dest} already holds a different repository (${originUrl || "no remote configured"}). Move or remove it, then retry.`,
      { path: dest, remoteUrl: originUrl ?? null }
    );
  }

  // Same transport as the clone itself: the token has to be re-supplied (it
  // was deliberately never written to .git/config), prompts have to stay
  // disabled, and the fetch has to be bounded — an unauthenticated fetch of a
  // private repo otherwise sits on a credential prompt until the request dies.
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const git = simpleGit({
      baseDir: dest,
      abort: controller.signal,
    }).env(nonInteractiveEnv());

    await git.raw([...authConfigArgs(token), "fetch", "origin"]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CloneError(
        "timeout",
        `Fetch aborted after ${Math.round(timeoutMs / 1000)}s while refreshing the existing clone at ${dest}. Raise the clone timeout or retry.`,
        { timeoutMs, path: dest }
      );
    }
    throw toCloneError(error, { cloneUrl, branch: options.branch, token });
  } finally {
    clearTimeout(timer);
  }

  // The existing checkout belongs to the user; a requested branch does not
  // justify switching it out from under them. What gets reported is the
  // remote's default branch, not whatever happens to be checked out — that
  // value is persisted as the project's base for worktrees and merges.
  const defaultBranch = await resolveDefaultBranch(dest);

  return {
    path: dest,
    defaultBranch,
    reused: true,
    durationMs: Date.now() - startedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Git plumbing                                                        */
/* ------------------------------------------------------------------ */

/**
 * `-c http.extraHeader=Authorization: Basic …` for an authenticated transport,
 * or nothing at all for a public repository.
 *
 * `-c` keeps the header out of `.git/config`: origin stays clean and the clone
 * carries no secret on disk. Every command that talks to the remote has to
 * re-supply it for exactly that reason — a private repository that cloned fine
 * would otherwise fail (or block on a credential prompt) the next time Arij
 * fetches it.
 */
function authConfigArgs(token?: string | null): string[] {
  const clean = token?.trim();
  if (!clean) return [];

  const basic = Buffer.from(`x-access-token:${clean}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}

function buildCloneArgs(input: {
  cloneUrl: string;
  dest: string;
  branch: string | null;
  token?: string | null;
}): string[] {
  const args = authConfigArgs(input.token);

  args.push("clone");
  if (input.branch) {
    args.push("--branch", input.branch);
  }
  // Deliberately no --depth / --single-branch: worktrees, merge-base and
  // release tagging all need the full history.
  args.push("--", input.cloneUrl, input.dest);

  return args;
}

/**
 * Git must never block on a credential prompt: without a terminal it would
 * hang until the timeout instead of failing with a usable message.
 */
function nonInteractiveEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GCM_INTERACTIVE: "never",
  };
}

function getGit(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

/**
 * True only when `dest` is the ROOT of a repository. `checkIsRepo()` walks up
 * the tree, so a plain directory under a clone root that itself sits inside a
 * git repository (the dogfooding case: `<arij>/projects/...`) would otherwise
 * look like a repo and be "reused".
 */
async function isRepositoryRoot(dest: string): Promise<boolean> {
  try {
    return await getGit(dest).checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
  } catch {
    return false;
  }
}

/**
 * The branch the *remote* treats as default, read from `origin/HEAD`.
 *
 * Not the same thing as the checked-out branch: a reused clone sits on
 * whatever the user last worked on, and this value is persisted as
 * `projects.default_branch` — the base every later worktree and merge starts
 * from. Falls back to the current branch when the remote advertised no HEAD.
 */
async function resolveDefaultBranch(repoPath: string): Promise<string> {
  // No origin/HEAD (a remote that never advertised one) falls through to
  // whatever is checked out — which for a fresh clone is the right answer.
  return (
    (await resolveRemoteDefaultBranch(repoPath)) ??
    (await getCurrentGitBranch(repoPath))
  );
}

async function readOriginUrl(repoPath: string): Promise<string | null> {
  try {
    const remotes = await getGit(repoPath).getRemotes(true);
    const origin =
      remotes.find((remote) => remote.name === "origin") ?? remotes[0];
    return origin?.refs?.fetch || origin?.refs?.push || null;
  } catch {
    return null;
  }
}

/** Compares two remotes ignoring credentials, `.git`, trailing slash and case. */
function sameRemote(a: string, b: string): boolean {
  return normalizeForComparison(a) === normalizeForComparison(b);
}

function normalizeForComparison(url: string): string {
  return url
    .trim()
    .replace(/:\/\/[^/\s@]+@/, "://")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function removeFailedClone(dest: string): void {
  try {
    fs.rmSync(dest, { recursive: true, force: true });
  } catch (error) {
    console.warn("[git/clone] could not clean up failed clone", {
      dest,
      error: redactGitError(error),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Error mapping                                                       */
/* ------------------------------------------------------------------ */

function toCloneError(
  error: unknown,
  context: { cloneUrl: string; branch?: string | null; token?: string | null }
): CloneError {
  if (error instanceof CloneError) return error;

  const secrets = context.token ? [context.token] : [];
  const message = redactGitError(error, secrets);
  const haystack = message.toLowerCase();

  const has = (...needles: string[]) =>
    needles.some((needle) => haystack.includes(needle));

  if (
    has("remote branch") ||
    has("did not match any file(s) known to git") ||
    (context.branch && has(`branch '${context.branch.toLowerCase()}'`))
  ) {
    return new CloneError(
      "branch_not_found",
      `Branch '${context.branch ?? ""}' does not exist in ${context.cloneUrl}.`,
      { branch: context.branch ?? null, detail: message }
    );
  }

  if (
    has(
      "authentication failed",
      "invalid username or password",
      "bad credentials",
      "403 forbidden",
      "401 unauthorized",
      "access denied"
    )
  ) {
    return new CloneError(
      "auth_failed",
      "GitHub rejected the stored credentials. Check the GitHub PAT in Settings — it may be expired or missing the `repo` scope.",
      { detail: message }
    );
  }

  if (
    has(
      "repository not found",
      "not found",
      "could not read username",
      "terminal prompts disabled",
      "does not appear to be a git repository"
    )
  ) {
    return new CloneError(
      "not_found",
      context.token
        ? `Repository not found: ${context.cloneUrl}. It does not exist, or the GitHub PAT in Settings does not grant access to it.`
        : `Repository not found: ${context.cloneUrl}. If it is private, add a GitHub PAT in Settings → GitHub PAT and retry.`,
      { detail: message, authenticated: !!context.token }
    );
  }

  if (
    has(
      "could not resolve host",
      "could not resolve proxy",
      "failed to connect",
      "connection refused",
      "connection reset",
      "network is unreachable",
      "operation timed out",
      "timed out",
      "unable to access",
      "ssl"
    )
  ) {
    return new CloneError(
      "network",
      `Could not reach ${context.cloneUrl}. Check your network connection and retry.`,
      { detail: message }
    );
  }

  return new CloneError("clone_failed", message || "git clone failed.", {
    detail: message,
  });
}
