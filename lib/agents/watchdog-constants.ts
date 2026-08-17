/**
 * Client-safe constants for the silent-session watchdog's staleness
 * threshold. Kept separate from lib/agents/watchdog.ts (which imports the
 * database, notifications, and the activity log) so client components can
 * import the setting keys without pulling server modules into the bundle —
 * same pattern as lib/agents/scheduler-constants.ts.
 */

/**
 * Global settings key: minutes of chunk silence after which a running agent
 * session is considered stalled. Stored in the key/value settings table
 * (JSON-encoded by the settings PATCH route).
 */
export const WATCHDOG_THRESHOLD_GLOBAL_SETTING_KEY =
  "watchdog_threshold_minutes";

/**
 * Per-agent-type settings key (`watchdog_threshold_minutes:<agentType>`),
 * following the `agent_max_concurrent:<projectId>` convention. Overrides the
 * global key for that agent type (e.g. a slower `team_build`).
 */
export function watchdogThresholdSettingKey(agentType: string): string {
  return `${WATCHDOG_THRESHOLD_GLOBAL_SETTING_KEY}:${agentType}`;
}

/** Built-in fallback when neither settings key is set. */
export const DEFAULT_WATCHDOG_THRESHOLD_MINUTES = 5;

/**
 * Agent types the watchdog never flags. Chat is interactive: long silences
 * are the user thinking, not the agent hanging. (Registry-only activities —
 * chat streams, spec generation — have no DB session row and never reach
 * the watchdog anyway; this guards the DB-session flavor of chat.)
 */
export const WATCHDOG_EXEMPT_AGENT_TYPES: ReadonlySet<string> = new Set([
  "chat",
]);

export function isWatchdogExemptAgentType(
  agentType: string | null | undefined
): boolean {
  return agentType != null && WATCHDOG_EXEMPT_AGENT_TYPES.has(agentType);
}

/**
 * Parses a raw settings value (JSON-encoded string, number, or numeric
 * string) into a threshold in minutes. Returns null for anything that is
 * not a positive finite number, so callers fall through to the next
 * default. Fractional minutes are allowed (useful for tests and impatient
 * humans).
 */
export function parseWatchdogThresholdMinutes(value: unknown): number | null {
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

  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}
