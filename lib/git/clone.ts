import { nonInteractiveEnv } from "./non-interactive";
export { nonInteractiveEnv } from "./non-interactive";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import simpleGit, { CheckRepoActions, type SimpleGit } from "simple-git";
import {
  parseGitHubOwnerRepoFromRemoteUrl,
  parseGitHubRepoInput,
  type ParsedGitHubRepoInput,
} from "./remote";
import { redactGitCredentials } from "./redact";
import { withPathLock } from "./clone-lock";
import { hasCloneMarkerFor, isArijManagedClone, writeCloneMarker } from "./clone-marker";
import { DEFAULT_CLONE_TIMEOUT_MS } from "./clone-constants";

/** Both entry points use the same lock, deadline, anonymous-first transport and
 * atomic staging. The GitHub import wrapper adds managed-clone provenance and
 * its established recovery/error contract; plain clones never claim ownership. */
export type CloneDestinationState =
  | "absent" | "empty" | "healthy_match" | "remote_mismatch"
  | "arij_debris" | "foreign_content";

export interface CloneRepoResult extends CloneRepositoryResult {
  owner: string;
  repo: string;
  ownerRepo: string;
  remoteUrl: string;
  managed: boolean;
  destinationState: CloneDestinationState;
}

export class CloneConflictError extends Error {
  readonly code = "clone_destination_conflict";
  constructor(
    readonly destination: string,
    readonly existingRemote: string | null,
    readonly state: CloneDestinationState = "foreign_content",
  ) {
    super(existingRemote
      ? `${destination} already contains a clone of ${existingRemote}. Arij will not modify it — remove it or change the projects root.`
      : `${destination} already exists and was not created by Arij. Arij will not modify it — remove it or change the projects root.`);
    this.name = "CloneConflictError";
  }
}

export class CloneFailedError extends Error {
  readonly code = "clone_failed";
  constructor(message: string) {
    super(redactGitCredentials(message));
    this.name = "CloneFailedError";
  }
}

export interface CloneGitHubRepositoryOptions {
  input: string;
  destination: string;
  token?: string | null;
  timeoutMs?: number;
}

/** Keeps the import API's conflict and offline-reuse contract. */
export async function cloneGitHubRepository(options: CloneGitHubRepositoryOptions): Promise<CloneRepoResult> {
  const parsed = parseGitHubRepoInput(options.input);
  if (!parsed) throw new CloneFailedError(
    `"${options.input}" is not a GitHub repository. Use https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo.`,
  );
  try {
    const result = await cloneWithPolicy({
      cloneUrl: parsed.cloneUrl, dest: options.destination,
      token: options.token, timeoutMs: options.timeoutMs,
    }, parsed);
    return { ...result, owner: parsed.owner, repo: parsed.repo,
      ownerRepo: parsed.ownerRepo, remoteUrl: parsed.cloneUrl };
  } catch (error) {
    if (error instanceof CloneError && error.code === "conflict") {
      throw new CloneConflictError(path.resolve(options.destination),
        typeof error.details.existingRemote === "string" ? error.details.existingRemote : null,
        (error.details.state as CloneDestinationState | undefined) ?? "foreign_content");
    }
    throw new CloneFailedError(redactGitError(error, options.token ? [options.token] : []).replaceAll("[REDACTED]", "[redacted]"));
  }
}

interface DestinationInspection {
  state: CloneDestinationState;
  existingRemote: string | null;
  stat: fs.Stats | null;
}

interface RepositoryIdentity {
  cloneUrl: string;
  expectedOwnerRepo?: string | null;
  managedIdentity?: ParsedGitHubRepoInput;
}

async function inspectDestination(destination: string, expected: RepositoryIdentity, deadline?: Deadline): Promise<DestinationInspection> {
  const stat = await fsp.lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const result = (state: CloneDestinationState, existingRemote: string | null = null) => ({ state, existingRemote, stat });
  if (!stat) return result("absent");
  // Never follow a symlink into a checkout we may later regard as managed.
  if (!stat.isDirectory()) return result("foreign_content");
  if ((await fsp.readdir(destination)).length === 0) return result("empty");

  let originUrl: string | null = null;
  let hasHead = false;
  try {
    const git = gitFor(destination, deadline);
    // A child directory under Arij's own checkout is not a reusable clone.
    if (await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)) {
      const origin = (await git.getRemotes(true)).find((remote) => remote.name === ORIGIN);
      originUrl = origin?.refs.fetch || origin?.refs.push || null;
      if (originUrl) {
        try { await git.revparse(["--verify", "HEAD"]); hasHead = true; } catch { /* unborn/broken */ }
      }
    }
  } catch { /* Unrecognised content remains a conflict. */ }
  if (deadline?.expired()) throw timeoutError(deadline);

  const originIdentity = originUrl ? parseGitHubOwnerRepoFromRemoteUrl(originUrl) : null;
  const expectedOwnerRepo = expected.managedIdentity?.ownerRepo ?? expected.expectedOwnerRepo
    ?? parseGitHubOwnerRepoFromRemoteUrl(expected.cloneUrl)?.ownerRepo;
  const matches = originUrl !== null && (sameRemote(originUrl, expected.cloneUrl)
    || Boolean(expectedOwnerRepo && originIdentity?.ownerRepo.toLowerCase() === expectedOwnerRepo.toLowerCase()));
  const existingRemote = originIdentity?.ownerRepo ?? (originUrl ? redactGitError(originUrl) : null);
  if (matches && hasHead) return result("healthy_match", existingRemote);
  // A marker for one repo never permits replacing a checkout of another repo.
  if (originUrl && !matches) return result("remote_mismatch", existingRemote);
  if (expected.managedIdentity && hasCloneMarkerFor(destination, expected.managedIdentity)) return result("arij_debris", existingRemote);
  return result("foreign_content", existingRemote);
}

export async function classifyCloneDestination(destination: string, expected: { owner: string; repo: string }): Promise<{ state: CloneDestinationState; existingRemote: string | null }> {
  const identity = parseGitHubRepoInput(`${expected.owner}/${expected.repo}`);
  if (!identity) return { state: "foreign_content", existingRemote: null };
  const { state, existingRemote } = await inspectDestination(destination, { cloneUrl: identity.cloneUrl, managedIdentity: identity });
  return { state, existingRemote };
}

/** Checked-out branch, then origin/HEAD, then the established main fallback. */
export async function detectDefaultBranch(repoPath: string, deadline?: Deadline): Promise<string> {
  const readRef = async (args: string[]): Promise<string | null> => {
    try { return (await gitFor(repoPath, deadline).raw(args)).trim(); } catch { return null; }
  };
  const current = await readRef(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current && current !== "HEAD") return current;
  const symbolic = await readRef(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (symbolic?.startsWith("origin/")) return symbolic.slice("origin/".length);
  return "main";
}

/** One-shot config: credentials stay out of origin and .git/config. */
export function buildAuthHeaderConfig(token: string): string {
  return `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token.trim()}`).toString("base64")}`;
}

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

export async function cloneRepository(options: CloneRepositoryOptions): Promise<CloneRepositoryResult> {
  const { path, defaultBranch, reused, durationMs } = await cloneWithPolicy(options);
  return { path, defaultBranch, reused, durationMs };
}

type ResolvedCloneOptions = CloneRepositoryOptions & RepositoryIdentity & {
  dest: string;
  branch: string | null;
};
type CloneOperationResult = CloneRepositoryResult & {
  managed: boolean;
  destinationState: CloneDestinationState;
};

async function cloneWithPolicy(options: CloneRepositoryOptions, managedIdentity?: ParsedGitHubRepoInput): Promise<CloneOperationResult> {
  const cloneUrl = options.cloneUrl?.trim() ?? "";
  const branch = options.branch?.trim() || null;
  if (!cloneUrl) throw new CloneError("invalid_input", "A clone URL is required.");
  if (!options.dest?.trim()) throw new CloneError("invalid_input", "A destination path is required.");
  if (cloneUrl.startsWith("-") || /^https?:\/\/[^/\s]*@/i.test(cloneUrl)) {
    throw new CloneError("invalid_input", "Clone URL must be a credential-free remote.");
  }
  if (branch?.startsWith("-")) throw new CloneError("invalid_input", `Invalid branch name: ${branch}`);
  const dest = path.resolve(options.dest);
  return withPathLock(dest, () => performClone({ ...options, cloneUrl, branch, dest, managedIdentity }));
}

async function performClone(options: ResolvedCloneOptions): Promise<CloneOperationResult> {
  const startedAt = Date.now();
  const deadline = startDeadline(options.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS);
  const { cloneUrl, dest, branch, token, managedIdentity } = options;
  try {
    const inspection = await inspectDestination(dest, options, deadline);
    const { state } = inspection;
    if (state === "healthy_match") {
      const defaultBranch = await detectDefaultBranch(dest, deadline);
      if (deadline.expired()) throw timeoutError(deadline);
      try {
        await runGitWithOptionalAuth({ baseDir: dest, deadline, token,
          context: { cloneUrl, branch }, buildArgs: (auth) => [...auth, "fetch", ORIGIN, "--prune"] });
      } catch (error) {
        // Import can still analyse an existing checkout while offline. The
        // generic service reports the failure to callers that require a fetch.
        if (!managedIdentity) throw error;
        console.warn("[clone] reuse fetch failed, continuing with existing clone:", redactGitError(error, token ? [token] : []));
      }
      return { path: dest, defaultBranch, reused: true,
        managed: isArijManagedClone(dest), destinationState: state, durationMs: Date.now() - startedAt };
    }
    if (state !== "absent" && !(managedIdentity && (state === "empty" || state === "arij_debris"))) {
      throw destinationConflict(dest, inspection);
    }

    const parent = path.dirname(dest);
    await fsp.mkdir(parent, { recursive: true });
    // mkdtemp establishes exclusive ownership. A matching filename from another
    // process is not evidence of abandonment, so no other staging dirs are swept.
    const staging = await fsp.mkdtemp(path.join(parent, ".arij-clone-"));
    try {
      await runGitWithOptionalAuth({ baseDir: parent, deadline, token,
        context: { cloneUrl, branch },
        buildArgs: (auth) => [...auth, "clone", ...(branch ? ["--branch", branch] : []), "--", cloneUrl, staging],
        beforeRetry: async () => {
          // Keep our private directory reserved while clearing the failed clone.
          for (const entry of await fsp.readdir(staging)) await fsp.rm(path.join(staging, entry), { recursive: true, force: true });
        },
      });
      const defaultBranch = await detectDefaultBranch(staging, deadline);
      if (deadline.expired()) throw timeoutError(deadline);
      const managed = managedIdentity ? await writeCloneMarker(staging, {
        ...managedIdentity, remoteUrl: managedIdentity.cloneUrl,
      }) : false;
      await claimDestination(staging, options, inspection, deadline);
      return { path: dest, defaultBranch, reused: false, managed, destinationState: state, durationMs: Date.now() - startedAt };
    } catch (error) {
      await discardStaging(staging);
      throw error;
    }
  } catch (error) {
    throw toCloneError(error, { cloneUrl, branch, token });
  } finally {
    deadline.dispose();
  }
}

function destinationConflict(dest: string, inspection: Pick<DestinationInspection, "state" | "existingRemote">): CloneError {
  return new CloneError("conflict", inspection.existingRemote
    ? `${dest} already holds a different or unusable repository (${ORIGIN}: ${inspection.existingRemote}). Move or remove it, then retry.`
    : `${dest} already exists and is not a reusable git repository with an '${ORIGIN}' remote. Move or remove it, then retry.`,
  { path: dest, remoteUrl: inspection.existingRemote, existingRemote: inspection.existingRemote, state: inspection.state });
}

/** Recheck anything we might replace after the download, under the shared lock. */
async function claimDestination(staging: string, options: ResolvedCloneOptions, initial: DestinationInspection, deadline: Deadline): Promise<void> {
  const current = await inspectDestination(options.dest, options, deadline);
  const sameDirectory = initial.stat && current.stat
    && initial.stat.dev === current.stat.dev && initial.stat.ino === current.stat.ino;
  if (current.state !== "absent") {
    if (!sameDirectory || current.state !== initial.state) throw destinationConflict(options.dest, current);
    if (current.state === "empty") await fsp.rmdir(options.dest);
    else if (current.state === "arij_debris" && options.managedIdentity) await fsp.rm(options.dest, { recursive: true, force: true });
    else throw destinationConflict(options.dest, current);
  } else if (initial.state !== "absent") {
    // Someone removed/replaced the initially classified directory while git ran.
    throw destinationConflict(options.dest, current);
  }
  try {
    await fsp.rename(staging, options.dest);
  } catch (error) {
    if (fs.existsSync(options.dest)) throw destinationConflict(options.dest, { state: "foreign_content", existingRemote: null });
    throw error;
  }
}

async function discardStaging(staging: string): Promise<void> {
  try { await fsp.rm(staging, { recursive: true, force: true }); }
  catch (error) { console.warn("[clone] could not clean up staging", staging, redactGitError(error)); }
}

/** GitHub identity spans SSH/HTTPS; other remotes retain the URL comparison. */
function sameRemote(a: string, b: string): boolean {
  const normalize = (url: string) => url.trim().replace(/:\/\/[^/\s@]+@/, "://").replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  return normalize(a) === normalize(b);
}

interface AuthenticatedRunOptions {
  baseDir: string;
  deadline: Deadline;
  token?: string | null;
  /** Builds the argv from the `-c` prefix to place before the subcommand. */
  buildArgs: (authArgs: string[]) => string[];
  /** Cleanup between the anonymous attempt and the authenticated retry. */
  beforeRetry?: () => void | Promise<void>;
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
    const anonymous = toCloneError(redactGitError(error, token ? [token] : []), { ...context, token: null });
    if (!token?.trim() || !isCredentialRecoverable(anonymous.code)) {
      throw anonymous;
    }
    await beforeRetry?.();
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

/**
 * Executes raw git command arguments with non-interactive environment safeguards
 * and abort signal handling.
 *
 * Invariant: All callers must validate user/agent-derived values (rejecting leading
 * dashes) and/or use `--` separators before positional arguments so that untrusted
 * strings cannot land in argv option position.
 */
function runGit(
  args: string[],
  baseDir: string,
  deadline: Deadline
): Promise<string> {
  if (deadline.expired()) return Promise.reject(timeoutError(deadline));
  return gitFor(baseDir, deadline).raw(args);
}

function gitFor(baseDir: string, deadline?: Deadline): SimpleGit {
  return simpleGit({ baseDir, abort: deadline?.signal, unsafe: { allowUnsafeAskPass: true } })
    .env(nonInteractiveEnv());
}

/**
 * `-c` scopes the header to this one invocation: it never reaches
 * `.git/config`, so `origin` stays clean and the clone carries no secret.
 */
function authConfigArgs(token?: string | null): string[] {
  const clean = token?.trim();
  if (!clean) return [];

  return ["-c", buildAuthHeaderConfig(clean)];
}


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
