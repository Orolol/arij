import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_PROJECTS_ROOT_DIRNAME,
  PROJECTS_ROOT_SETTING_KEY,
  cloneDirName,
  parseProjectsRootSetting,
} from "./workspace-constants";

/**
 * Server-side resolution of the app-managed clone root.
 *
 * Clones land in `<projects_root>/<owner>-<repo>`, which puts worktrees in
 * `<projects_root>/.arij-worktrees` for free: createWorktree() (lib/git/
 * manager.ts) places them at `path.join(repoPath, "..", ".arij-worktrees")`.
 */

/** Absolute path of the clone root: the `projects_root` setting, or `<cwd>/projects`. */
export function resolveProjectsRoot(): string {
  let configured: string | null = null;

  try {
    const row = db
      .select()
      .from(settings)
      .where(eq(settings.key, PROJECTS_ROOT_SETTING_KEY))
      .get();
    configured = row ? parseProjectsRootSetting(row.value) : null;
  } catch (error) {
    // A settings read failure must not block a clone — fall back to the default.
    console.warn("[projects/workspace] could not read projects_root", error);
  }

  return path.resolve(
    configured ?? path.join(process.cwd(), DEFAULT_PROJECTS_ROOT_DIRNAME)
  );
}

/** Creates the clone root if missing and returns it. */
export function ensureProjectsRoot(root: string = resolveProjectsRoot()): string {
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Absolute destination of a clone. `owner`/`repo` must already be validated
 * (see `parseGitHubRepoInput()`); the containment assertion below is a second
 * line of defence, not the first.
 */
export function cloneDestination(
  owner: string,
  repo: string,
  root: string = resolveProjectsRoot()
): string {
  const dest = path.resolve(root, cloneDirName(owner, repo));
  if (dest !== path.join(root, path.basename(dest))) {
    throw new Error(`Refusing to clone outside the workspace root: ${dest}`);
  }
  return dest;
}
