/**
 * Client-safe constants for the agent scheduler's per-project concurrency
 * budget. Kept separate from lib/agents/scheduler.ts (which imports the
 * database) so client components can import the setting keys without pulling
 * server modules into the bundle — same pattern as
 * lib/agent-config/review-segregation-constants.ts.
 */

/**
 * Global settings key: default "Max concurrent agents" for projects without
 * a per-project override. Stored in the key/value settings table
 * (JSON-encoded by the settings PATCH route).
 */
export const AGENT_MAX_CONCURRENT_GLOBAL_SETTING_KEY = "agent_max_concurrent";

/**
 * Per-project settings key (`agent_max_concurrent:<projectId>`), following
 * the `webhook_url:<id>` convention. Overrides the global key.
 */
export function agentMaxConcurrentSettingKey(projectId: string): string {
  return `${AGENT_MAX_CONCURRENT_GLOBAL_SETTING_KEY}:${projectId}`;
}

/** Built-in fallback when neither settings key is set. */
export const DEFAULT_MAX_CONCURRENT_AGENTS = 3;

/**
 * Parses a raw settings value (JSON-encoded string, number, or numeric
 * string) into a usable concurrency budget. Returns null for anything that
 * is not a positive integer, so callers fall through to the next default.
 * A budget below 1 would deadlock the queue, so 0 and negatives are invalid.
 */
export function parseMaxConcurrentSetting(value: unknown): number | null {
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

  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}
