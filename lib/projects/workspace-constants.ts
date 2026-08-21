/**
 * Client-safe constants for the app-managed clone root.
 *
 * Kept separate from lib/projects/workspace.ts (which imports the database and
 * node:path) so the Settings page can import the setting key and the parser
 * without pulling server modules into the client bundle — same pattern as
 * lib/agents/scheduler-constants.ts and lib/night/constants.ts.
 */

/**
 * Settings key holding the absolute directory Arij clones repositories into.
 * Unset means `<cwd>/projects` (see `defaultProjectsRoot()` in workspace.ts).
 */
export const PROJECTS_ROOT_SETTING_KEY = "projects_root";

/** Directory name used for the default root, relative to the Arij install. */
export const DEFAULT_PROJECTS_ROOT_DIRNAME = "projects";

/**
 * Owner and repo segments are re-validated against this before they are ever
 * concatenated into a filesystem path. It excludes `/`, `\` and every other
 * separator, so a crafted URL cannot escape the clone root; `.` and `..` are
 * rejected separately because they match the character class.
 */
export const GITHUB_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** True when `value` is safe to use as one path segment of a clone directory. */
export function isSafeRepoNameSegment(value: string): boolean {
  if (!GITHUB_NAME_PATTERN.test(value)) return false;
  return value !== "." && value !== "..";
}

/**
 * Directory name of a clone: `<owner>-<repo>`. Deterministic, so re-importing
 * the same URL resolves to the same directory and takes the reuse path, and
 * collision-free across owners of same-named repositories.
 */
export function cloneDirectoryName(owner: string, repo: string): string {
  return `${owner}-${repo}`;
}

/**
 * Parses the raw `projects_root` settings value (JSON-encoded string or raw
 * string) into a usable absolute path. Returns null for anything that is not a
 * non-empty absolute path, so callers fall through to the built-in default
 * rather than cloning into a surprising relative location.
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
  // Relative roots would resolve against the server's cwd at call time, which
  // silently moves clones when the process is started from elsewhere.
  if (!trimmed.startsWith("/")) return null;

  return trimmed;
}
