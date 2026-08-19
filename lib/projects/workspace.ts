import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_PROJECTS_DIRNAME,
  PROJECTS_ROOT_SETTING_KEY,
  parseProjectsRoot,
} from "./workspace-constants";

/**
 * Server-side resolution of the app-managed clone root.
 *
 * Every repository Arij clones lands in `<root>/<owner>-<repo>`, which becomes
 * the project's `git_repo_path`. Worktrees are then created at
 * `path.join(repoPath, "..", ".arij-worktrees")` (lib/git/manager.ts), i.e.
 * `<root>/.arij-worktrees` — so a single `/projects` .gitignore rule covers
 * both clones and their worktrees when dogfooding Arij on itself.
 */

/** Built-in root used when no `projects_root` override is configured. */
export function defaultProjectsRoot(): string {
  return path.join(process.cwd(), DEFAULT_PROJECTS_DIRNAME);
}

/**
 * The effective clone root: the `projects_root` setting when set, otherwise
 * `<cwd>/projects`. Always absolute — a relative override is anchored to the
 * working directory so clone destinations never depend on the caller's cwd.
 */
export function resolveProjectsRoot(): string {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, PROJECTS_ROOT_SETTING_KEY))
    .get();

  const override = row ? parseProjectsRoot(row.value) : null;
  if (!override) return defaultProjectsRoot();

  return path.resolve(process.cwd(), override);
}

/**
 * Creates the clone root if it does not exist and returns it. A no-op when the
 * directory is already there (`mkdirSync` with `recursive: true`).
 */
export function ensureProjectsRoot(): string {
  const root = resolveProjectsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Guards a clone destination against escaping the root.
 *
 * The URL parsing layer already validates owner/repo, but this is the last
 * line of defence before any filesystem write: a crafted `owner` such as
 * `../../etc` must never resolve outside the root. The root itself is rejected
 * too — cloning into it would nest every later clone inside the first one.
 *
 * Returns the resolved absolute destination.
 */
export function assertInsideRoot(
  destination: string,
  root: string = resolveProjectsRoot()
): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, destination);

  if (resolved === resolvedRoot || !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(
      `Refusing to use a path outside the projects root: ${destination}`
    );
  }

  return resolved;
}

/** Owner and repository segments Arij accepts in a clone destination. */
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertSegment(value: string, label: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";

  // `.` and `..` match the character class but are traversal components.
  if (!SEGMENT_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid GitHub ${label}: ${JSON.stringify(value)}`);
  }

  return trimmed;
}

/**
 * Destination directory for a clone of `owner/repo`: `<root>/<owner>-<repo>`.
 *
 * Deterministic and collision-free across owners, which makes re-importing the
 * same repository idempotent — the clone service can detect the existing
 * directory and fetch instead of re-cloning.
 */
export function cloneDestinationFor(
  owner: string,
  repo: string,
  root: string = resolveProjectsRoot()
): string {
  const resolvedRoot = path.resolve(root);
  const dirName = `${assertSegment(owner, "owner")}-${assertSegment(repo, "repository")}`;
  return assertInsideRoot(dirName, resolvedRoot);
}
