/**
 * Client-safe constants for the app-managed clone root — the directory Arij
 * clones GitHub repositories into.
 *
 * Kept separate from lib/projects/workspace.ts (which imports the database and
 * node:fs) so client components — the Settings page — can import the setting
 * key and the parser without pulling server modules into the bundle. Same
 * pattern as lib/agents/scheduler-constants.ts and lib/night/constants.ts.
 */

/**
 * Global settings key holding the user's clone-root override. Stored in the
 * key/value settings table (JSON-encoded by the settings PATCH route).
 */
export const PROJECTS_ROOT_SETTING_KEY = "projects_root";

/**
 * Directory name appended to `process.cwd()` when no override is configured.
 * Mirrored by the `/projects` rule in the repo's .gitignore so dogfooding
 * never commits a clone.
 */
export const DEFAULT_PROJECTS_DIRNAME = "projects";

/**
 * Normalizes a raw settings value into a clone-root override.
 *
 * Accepts both shapes the value takes in practice: the JSON-encoded text read
 * straight from the settings row (server side) and the already-decoded value
 * the GET route hands to the client.
 *
 * Returns null for anything that is not a non-empty string, so callers fall
 * back to `<cwd>/projects`. A blank string is how the Settings page clears the
 * override, and must therefore read as "no override" rather than "root is ''"
 * — an empty root would resolve to the working directory and scatter clones
 * across the app checkout.
 */
export function parseProjectsRoot(value: unknown): string | null {
  let candidate: unknown = value;

  if (typeof candidate === "string") {
    try {
      const decoded: unknown = JSON.parse(candidate);
      // Only a decoded string replaces the raw text: a path that happens to be
      // valid JSON (e.g. "123") must stay the literal directory name.
      if (typeof decoded === "string") candidate = decoded;
    } catch {
      // raw (non-JSON) string — use as-is
    }
  }

  if (typeof candidate !== "string") return null;

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}
