import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_PROJECTS_ROOT_DIRNAME,
  PROJECTS_ROOT_SETTING_KEY,
  cloneDirectoryName,
  isSafeRepoNameSegment,
  parseProjectsRootSetting,
} from "./workspace-constants";

/**
 * Resolution of the app-managed clone root, and the containment check every
 * destructive operation on a clone has to pass first.
 *
 * The root is the security boundary of the whole clone feature: Arij only ever
 * creates directories inside it, and only ever deletes directories that are
 * still inside it *and* that it recorded as its own (`clone_source = 'github'`).
 */

/** `<cwd>/projects` — the root used when `projects_root` is not configured. */
export function defaultProjectsRoot(cwd: string = process.cwd()): string {
  return path.join(cwd, DEFAULT_PROJECTS_ROOT_DIRNAME);
}

/**
 * The configured clone root, or the default. Never throws: a malformed or
 * relative settings value falls back to the default rather than pointing
 * clone/delete at an unexpected directory.
 */
export function resolveProjectsRoot(): string {
  let raw: string | undefined;
  try {
    raw = db
      .select()
      .from(settings)
      .where(eq(settings.key, PROJECTS_ROOT_SETTING_KEY))
      .get()?.value;
  } catch {
    raw = undefined;
  }

  const configured = parseProjectsRootSetting(raw);
  return path.resolve(configured ?? defaultProjectsRoot());
}

/** Creates the clone root if it does not exist yet. Returns the resolved root. */
export function ensureProjectsRoot(root: string = resolveProjectsRoot()): string {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

/**
 * True when `candidate` is a strict descendant of `root`.
 *
 * Strict on purpose: the root itself is never removable, and a sibling whose
 * name merely shares the prefix (`/projects-backup` vs `/projects`) must not
 * pass. Paths are resolved but deliberately not symlink-resolved here — callers
 * that delete pass a `realpath`ed candidate (see `containsPathOnDisk`).
 */
export function isInsideProjectsRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot) return false;

  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

/**
 * Containment check that additionally collapses symlinks on both sides, so a
 * symlink planted inside the root cannot smuggle a delete out of it. Falls back
 * to the plain check for paths that do not exist on disk.
 */
export function containsPathOnDisk(candidate: string, root: string): boolean {
  if (!isInsideProjectsRoot(candidate, root)) return false;

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(path.resolve(root));
  } catch {
    return true; // root itself is not on disk yet — plain check already passed
  }

  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(path.resolve(candidate));
  } catch {
    return true; // candidate does not exist — nothing to delete anyway
  }

  return isInsideProjectsRoot(realCandidate, realRoot);
}

/** Where `.arij-worktrees` lives for a clone at `<root>/<owner>-<repo>`. */
export function worktreesRootFor(repoPath: string): string {
  return path.join(path.resolve(repoPath), "..", ".arij-worktrees");
}

/**
 * Absolute destination of a clone. Throws on an unsafe owner/repo rather than
 * returning a path — every caller treats this as a hard failure.
 */
export function resolveCloneDestination(
  owner: string,
  repo: string,
  root: string = resolveProjectsRoot()
): string {
  if (!isSafeRepoNameSegment(owner) || !isSafeRepoNameSegment(repo)) {
    throw new Error(`Unsafe repository identifier: ${owner}/${repo}`);
  }

  const destination = path.join(
    path.resolve(root),
    cloneDirectoryName(owner, repo)
  );

  // Belt and braces: even with validated segments, never hand back a path that
  // is not inside the root.
  if (!isInsideProjectsRoot(destination, root)) {
    throw new Error(`Clone destination escapes the projects root: ${destination}`);
  }

  return destination;
}
