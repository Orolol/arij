/**
 * Client-safe constants for the learned project memory document.
 *
 * The memory doc lives in the `documents` table as a normal row whose
 * `kind` is 'memory' — the least invasive discriminator: prompt assembly
 * already filters reference documents on `kind = 'text'`
 * (see lib/documents/query.ts), so the memory doc never double-injects as a
 * reference document, and image handling (`kind = 'image'`) is untouched.
 *
 * Kept separate from lib/documents/memory.ts (which imports the database)
 * so client components can import the kind/cap without pulling server
 * modules into the bundle — same pattern as
 * lib/agents/scheduler-constants.ts.
 */

/** `documents.kind` value reserved for the per-project memory document. */
export const MEMORY_DOC_KIND = "memory";

/**
 * Display name stored in `documents.original_filename`. Deliberately not a
 * real filename: uploads keep their extensions, so collisions with the
 * per-project case-insensitive filename uniqueness are practically
 * impossible.
 */
export const MEMORY_DOC_FILENAME = "Project memory";

/**
 * Hard cap on the memory doc body, enforced on every write path (manual
 * editor rejects, distillation truncates). Keeps the prompt injection
 * token-cheap by construction.
 */
export const PROJECT_MEMORY_MAX_CHARS = 4000;

/**
 * Settings key for the optional auto-distillation mode: when the stored
 * value parses to `true` (JSON boolean or the string "true"), a successful
 * build-type session enqueues a memory-distill session on completion.
 * DEFAULT OFF — absent key means disabled.
 */
export const MEMORY_AUTO_DISTILL_SETTING_KEY = "memory_auto_distill";

/** Tolerant parse of the settings row value ('true'/'false', default off). */
export function parseMemoryAutoDistillSetting(value: unknown): boolean {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // raw (non-JSON) string — compare as-is below
    }
  }
  if (parsed === true) return true;
  if (typeof parsed === "string") return parsed.trim().toLowerCase() === "true";
  return false;
}
