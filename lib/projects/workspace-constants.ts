/**
 * Client-safe constants for the app-managed clone workspace — the root
 * directory Arij clones GitHub repositories into.
 *
 * Kept free of any database / node:fs import (lib/projects/workspace.ts holds
 * those) so the Settings UI can import the key, the default and the parser
 * without pulling server modules into the bundle — same pattern as
 * lib/agents/scheduler-constants.ts and lib/night/constants.ts.
 */

/**
 * Settings key holding the absolute path Arij clones into. Absent = the
 * default below. Stored in the key/value settings table (JSON-encoded by the
 * settings PATCH route).
 */
export const PROJECTS_ROOT_SETTING_KEY = "projects_root";

/** Directory under the Arij working directory used when the key is unset. */
export const DEFAULT_PROJECTS_ROOT_DIRNAME = "projects";

/**
 * Parses a raw settings value (JSON-encoded string or raw string) into an
 * absolute-ish clone root. Returns null for anything unusable so callers fall
 * through to the default — a relative or empty root would scatter clones
 * relative to whatever cwd the server happened to start in.
 */
export function parseProjectsRootSetting(value: unknown): string | null {
  let parsed: unknown = value;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // raw (non-JSON) string — use as-is
    }
  }

  if (typeof parsed !== "string") return null;

  const trimmed = parsed.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0")) return null;
  // Only absolute roots: a relative one silently moves with the cwd.
  if (!trimmed.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(trimmed)) return null;

  return trimmed;
}

/**
 * Directory name of a clone inside the root: `<owner>-<repo>`.
 * Deterministic (so re-importing the same repo is idempotent) and
 * collision-free across owners.
 *
 * Callers must pass an owner/repo already validated by
 * `parseGitHubRepoInput()` — this function does not sanitize.
 */
export function cloneDirName(owner: string, repo: string): string {
  return `${owner}-${repo}`;
}
