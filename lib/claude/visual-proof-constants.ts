/**
 * Client-safe half of the visual-proof setting.
 *
 * `lib/claude/visual-proof.ts` reads the row through `db`, which drags
 * better-sqlite3 into any bundle that imports it. The settings screen needs
 * the key and the parser, never the database, so both live here and the
 * server module re-exports them.
 */

/** Global opt-in for best-effort screenshot instructions in build prompts. */
export const VISUAL_PROOF_ENABLED_SETTING_KEY = "visual_proof_enabled";

/**
 * Parse the setting without collapsing an invalid or absent value into an
 * override. `null` is the unconfigured state; the built-in default is OFF.
 */
export function parseVisualProofEnabledSetting(
  value: unknown
): boolean | null {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // Legacy bare strings are compared below.
    }
  }

  if (parsed === true) return true;
  if (parsed === false) return false;
  if (typeof parsed === "string") {
    const normalized = parsed.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}
