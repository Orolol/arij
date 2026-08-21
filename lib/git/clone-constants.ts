/**
 * Client-safe constants for the git clone service (lib/git/clone.ts).
 *
 * Kept free of `simple-git` / `node:fs` / `db` imports so the Settings UI can
 * import the key, the default and the parser without pulling server modules
 * into the bundle — same pattern as lib/agents/scheduler-constants.ts.
 */

/**
 * Settings key holding the wall-clock budget of a single `git clone`, in
 * milliseconds. Absent/invalid = DEFAULT_CLONE_TIMEOUT_MS.
 */
export const CLONE_TIMEOUT_SETTING_KEY = "clone_timeout_ms";

/**
 * 10 minutes. Full clones (no `--depth`) of a large repository over a slow
 * link are legitimately slow, so the default is generous; the point of the
 * timeout is to end a hung connection, not to cap normal work.
 */
export const DEFAULT_CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** Lower bound: below this even a trivial clone would race the timer. */
export const MIN_CLONE_TIMEOUT_MS = 1_000;

/**
 * Parses a raw settings value (JSON-encoded number, number, or numeric
 * string) into a timeout. Returns null for anything that is not a positive
 * integer of at least MIN_CLONE_TIMEOUT_MS, so callers fall through to the
 * default rather than aborting every clone instantly.
 */
export function parseCloneTimeoutSetting(value: unknown): number | null {
  let parsed: unknown = value;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // raw (non-JSON) string — fall through to numeric coercion
    }
  }

  const num =
    typeof parsed === "number"
      ? parsed
      : typeof parsed === "string" && parsed.trim() !== ""
        ? Number(parsed)
        : NaN;

  if (!Number.isInteger(num) || num < MIN_CLONE_TIMEOUT_MS) return null;
  return num;
}
