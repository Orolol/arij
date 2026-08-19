import fs from "node:fs";
import path from "node:path";
import simpleGit, { CheckRepoActions, type SimpleGit } from "simple-git";
import { createId } from "@/lib/utils/nanoid";
import {
  getCurrentGitBranch,
  parseGitHubOwnerRepoFromRemoteUrl,
} from "./remote";
import { DEFAULT_CLONE_TIMEOUT_MS } from "./clone-constants";

/**
 * Git clone service.
 *
 * Clones a repository into an app-managed directory, authenticating with the
 * PAT stored in settings only when the anonymous attempt proves it necessary.
 * Four invariants drive the implementation:
 *
 *  1. **Full clones only.** No `--depth`, no `--single-branch`: Arij creates
 *     worktrees off `main`, merges epic branches and tags releases, all of
 *     which need complete history.
 *  2. **The token is a last resort, and never touches disk.** Public
 *     repositories are cloned anonymously; the PAT is only replayed when the
 *     anonymous attempt fails for a credential reason. It is then passed as an
 *     `http.extraHeader` via `-c`, so it stays out of `.git/config` and
 *     `origin` keeps the clean URL — `fetch`/`pull`/`push` afterwards behave
 *     like a hand-made clone.
 *  3. **Nothing existing is ever destroyed.** A destination whose `origin`
 *     already points at the requested repository is reused (fetch only);
 *     anything else is a conflict. The clone is assembled in a private staging
 *     directory and moved into place at the end, so cleanup can only ever
 *     delete a directory this service created.
 *  4. **Every remote call is bounded.** Clone and reuse-fetch alike run under
 *     one deadline and with credential prompts disabled, so a stalled
 *     connection fails with a message instead of hanging the request.
 */

export type CloneErrorCode =
  | "invalid_input"
  | "workspace_unavailable"
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
  /** GitHub PAT, replayed as an Authorization header for a single command. */
  token?: string | null;
  /**
   * `owner/repo` an existing destination's `origin` must already point at to
   * be reused. When omitted, reuse compares `origin` with `cloneUrl`.
   */
  expectedOwnerRepo?: string | null;
  /** Wall-clock budget for the whole operation; git is aborted past it. */
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

/** The only remote a reused clone is validated against, and fetched from. */
const ORIGIN = "origin";

/**
 * Prefix of the staging directory a fresh clone is assembled in. Hidden, and a
 * sibling of the destination so the final move is a same-filesystem rename.
 *
 * Every code path removes its own staging directory; only a hard kill mid-clone
 * can leave one behind. Those are deliberately NOT swept on the next clone —
 * another process may be cloning into one right now, and no local check can
 * tell the two apart. They sit inert under the (gitignored) clone root.
 */
const STAGING_PREFIX = ".arij-clone-";

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
 * repository would otherwise race: both stage a clone, and the loser's rename
 * would land on the winner's work tree. The second caller waits and then takes
 * the reuse path.
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
/* Deadline                                                            */
/* ------------------------------------------------------------------ */

interface Deadline {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  expired(): boolean;
  dispose(): void;
}

function startDeadline(timeoutMs: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    timeoutMs,
    expired: () => controller.signal.aborted,
    dispose: () => clearTimeout(timer),
  };
}

function timeoutError(deadline: Deadline): CloneError {
  return new CloneError(
    "timeout",
    `Clone aborted after ${Math.round(deadline.timeoutMs / 1000)}s. The repository may be very large or the connection stalled — raise the clone timeout in Settings or retry.`,
    { timeoutMs: deadline.timeoutMs }
  );
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

type ResolvedCloneOptions = CloneRepositoryOptions & {
  dest: string;
  branch: string | null;
};

async function runClone(
  options: ResolvedCloneOptions
): Promise<CloneRepositoryResult> {
  const startedAt = Date.now();
  const deadline = startDeadline(
    options.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS
  );

  try {
    return fs.existsSync(options.dest)
      ? await reuseExistingClone(options, startedAt, deadline)
      : await cloneIntoDestination(options, startedAt, deadline);
  } finally {
    deadline.dispose();
  }
}

async function cloneIntoDestination(
  options: ResolvedCloneOptions,
  startedAt: number,
  deadline: Deadline
): Promise<CloneRepositoryResult> {
  const { cloneUrl, dest, branch, token } = options;
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });

  // Clone into a staging directory and move it into place at the very end. The
  // destination is therefore created by a single rename: a failure leaves no
  // half-written tree to be "reused" later, and the cleanup below can only
  // ever delete a directory this call created — never one that another process
  // dropped at `dest` while git was running.
  const staging = path.join(parent, `${STAGING_PREFIX}${createId()}`);

  try {
    await runGitWithOptionalAuth({
      baseDir: parent,
      deadline,
      token,
      context: { cloneUrl, branch },
      buildArgs: (auth) => [
        ...auth,
        "clone",
        ...(branch ? ["--branch", branch] : []),
        // Deliberately no --depth / --single-branch: worktrees, merge-base and
        // release tagging all need the full history.
        "--",
        cloneUrl,
        staging,
      ],
      // The failed attempt left a partial tree in the way of the retry.
      beforeRetry: () => discardStaging(staging),
    });

    claimDestination(staging, dest);

    return {
      path: dest,
      defaultBranch: await getCurrentGitBranch(dest),
      reused: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    discardStaging(staging);
    throw error instanceof CloneError
      ? error
      : toCloneError(error, { cloneUrl, branch, token });
  }
}

/**
 * Moves a finished staging clone onto the destination. The destination is only
 * ever taken by `rename`, which refuses to clobber a non-empty directory, so a
 * directory that appeared while git was running is reported as a conflict
 * rather than overwritten.
 */
function claimDestination(staging: string, dest: string): void {
  if (fs.existsSync(dest)) {
    throw new CloneError(
      "conflict",
      `${dest} appeared while the clone was running and was left untouched. Move or remove it, then retry.`,
      { path: dest }
    );
  }

  try {
    fs.renameSync(staging, dest);
  } catch (error) {
    if (fs.existsSync(dest)) {
      throw new CloneError(
        "conflict",
        `${dest} appeared while the clone was running and was left untouched. Move or remove it, then retry.`,
        { path: dest }
      );
    }
    throw new CloneError(
      "clone_failed",
      `Could not move the finished clone into ${dest}: ${redactGitError(error)}`,
      { path: dest }
    );
  }
}

/**
 * A destination that already exists is never overwritten: either its `origin`
 * points at the requested repository (fetch and reuse) or the caller gets a
 * conflict naming what is in the way.
 */
async function reuseExistingClone(
  options: ResolvedCloneOptions,
  startedAt: number,
  deadline: Deadline
): Promise<CloneRepositoryResult> {
  const { dest, cloneUrl, branch, expectedOwnerRepo, token } = options;

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

  // Only `origin` counts: it is the remote the reuse path goes on to fetch, so
  // validating any other remote would approve a clone that then updates from
  // somewhere else entirely.
  const originUrl = await readRemoteUrl(dest, ORIGIN);
  if (!originUrl) {
    throw new CloneError(
      "conflict",
      `${dest} already exists and has no '${ORIGIN}' remote. Move or remove it, then retry.`,
      { path: dest, remoteUrl: null }
    );
  }

  const originOwnerRepo =
    parseGitHubOwnerRepoFromRemoteUrl(originUrl)?.ownerRepo ?? null;
  // Identity is owner/repo when both sides are GitHub — an `ssh://` clone made
  // by hand and an `https://` import URL are the same repository.
  const matches =
    sameRemote(originUrl, cloneUrl) ||
    (!!expectedOwnerRepo &&
      !!originOwnerRepo &&
      originOwnerRepo.toLowerCase() === expectedOwnerRepo.toLowerCase());

  if (!matches) {
    throw new CloneError(
      "conflict",
      `${dest} already holds a different repository (${ORIGIN}: ${originUrl}). Move or remove it, then retry.`,
      { path: dest, remoteUrl: originUrl }
    );
  }

  // Fetched through the same credential path as the clone: a private clone
  // Arij made carries no stored credentials of its own, and an unbounded fetch
  // would sit here waiting for some until the request itself died.
  await runGitWithOptionalAuth({
    baseDir: dest,
    deadline,
    token,
    context: { cloneUrl, branch },
    buildArgs: (auth) => [...auth, "fetch", ORIGIN],
  });

  // The existing checkout belongs to the user; a requested branch does not
  // justify switching it out from under them. Report what is actually there.
  return {
    path: dest,
    defaultBranch: await getCurrentGitBranch(dest),
    reused: true,
    durationMs: Date.now() - startedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Git plumbing                                                        */
/* ------------------------------------------------------------------ */

interface AuthenticatedRunOptions {
  baseDir: string;
  deadline: Deadline;
  token?: string | null;
  /** Builds the argv from the `-c` prefix to place before the subcommand. */
  buildArgs: (authArgs: string[]) => string[];
  /** Cleanup between the anonymous attempt and the authenticated retry. */
  beforeRetry?: () => void;
  context: { cloneUrl: string; branch?: string | null };
}

/**
 * Runs a git command anonymously, and replays it with the PAT only if the
 * anonymous attempt failed for a credential reason.
 *
 * Anonymous-first is what keeps a public clone free of the token: sending it
 * unconditionally would both contradict that guarantee and let an expired PAT
 * break a clone that needs no credentials at all.
 */
async function runGitWithOptionalAuth(
  options: AuthenticatedRunOptions
): Promise<void> {
  const { baseDir, deadline, token, buildArgs, beforeRetry, context } = options;

  try {
    await runGit(buildArgs([]), baseDir, deadline);
    return;
  } catch (error) {
    if (deadline.expired()) throw timeoutError(deadline);

    // Classified as if no credentials existed — because none were sent.
    const anonymous = toCloneError(error, { ...context, token: null });
    if (!token?.trim() || !isCredentialRecoverable(anonymous.code)) {
      throw anonymous;
    }
    beforeRetry?.();
  }

  try {
    await runGit(buildArgs(authConfigArgs(token)), baseDir, deadline);
  } catch (error) {
    if (deadline.expired()) throw timeoutError(deadline);
    throw toCloneError(error, { ...context, token });
  }
}

/** Failures a stored PAT could plausibly fix. */
function isCredentialRecoverable(code: CloneErrorCode): boolean {
  return code === "not_found" || code === "auth_failed";
}

function runGit(
  args: string[],
  baseDir: string,
  deadline: Deadline
): Promise<string> {
  return simpleGit({ baseDir, abort: deadline.signal })
    .env(nonInteractiveEnv())
    .raw(args);
}

/**
 * `-c` scopes the header to this one invocation: it never reaches
 * `.git/config`, so `origin` stays clean and the clone carries no secret.
 */
function authConfigArgs(token?: string | null): string[] {
  const clean = token?.trim();
  if (!clean) return [];

  const basic = Buffer.from(`x-access-token:${clean}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
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

async function readRemoteUrl(
  repoPath: string,
  name: string
): Promise<string | null> {
  try {
    const remotes = await getGit(repoPath).getRemotes(true);
    const remote = remotes.find((candidate) => candidate.name === name);
    return remote?.refs?.fetch || remote?.refs?.push || null;
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

/** Removes a staging directory. Only ever called on a path this service made. */
function discardStaging(staging: string): void {
  try {
    fs.rmSync(staging, { recursive: true, force: true });
  } catch (error) {
    console.warn("[git/clone] could not clean up the staging directory", {
      staging,
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
