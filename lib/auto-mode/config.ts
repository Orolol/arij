import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  AUTO_MODE_BUILD_AGENT_SETTING_KEY,
  AUTO_MODE_BUILD_CONCURRENCY_SETTING_KEY,
  AUTO_MODE_ENABLED_SETTING_KEY,
  AUTO_MODE_REVIEW_AGENT_SETTING_KEY,
  AUTO_MODE_REVIEW_CONCURRENCY_SETTING_KEY,
  DEFAULT_AUTO_BUILD_CONCURRENCY,
  DEFAULT_AUTO_REVIEW_CONCURRENCY,
  autoModeBuildAgentSettingKey,
  autoModeBuildConcurrencySettingKey,
  autoModeEnabledSettingKey,
  autoModeReviewAgentSettingKey,
  autoModeReviewConcurrencySettingKey,
  parseAutoModeAgent,
  parseAutoModeConcurrency,
  parseAutoModeEnabled,
  type AutoModeConfig,
} from "./constants";

/**
 * Server-side resolver for the Full Auto Mode configuration — the direct
 * counterpart of `resolveMaxConcurrentForProject` (lib/agents/scheduler.ts):
 * per-project key → global key → built-in default, one level at a time.
 *
 * Deliberately NOT cached. The sweep calls this on every tick, so flipping
 * the switch or retuning a budget in the dialog takes effect on the next
 * sweep without a server restart — the same posture the scheduler takes with
 * its budget and the watchdog with its thresholds.
 */

/** The ten keys the resolver may need, read in a single query per call. */
function readSettingsMap(projectId: string): Map<string, string> {
  const keys = [
    autoModeEnabledSettingKey(projectId),
    AUTO_MODE_ENABLED_SETTING_KEY,
    autoModeBuildAgentSettingKey(projectId),
    AUTO_MODE_BUILD_AGENT_SETTING_KEY,
    autoModeBuildConcurrencySettingKey(projectId),
    AUTO_MODE_BUILD_CONCURRENCY_SETTING_KEY,
    autoModeReviewAgentSettingKey(projectId),
    AUTO_MODE_REVIEW_AGENT_SETTING_KEY,
    autoModeReviewConcurrencySettingKey(projectId),
    AUTO_MODE_REVIEW_CONCURRENCY_SETTING_KEY,
  ];

  const rows = db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, keys))
    .all();

  return new Map(rows.map((row) => [row.key, row.value]));
}

/**
 * Effective Full Auto Mode configuration for a project. Re-read from the
 * settings table on every call.
 */
export function resolveAutoModeConfigForProject(
  projectId: string
): AutoModeConfig {
  const map = readSettingsMap(projectId);

  const pick = <T>(
    perProjectKey: string,
    globalKey: string,
    parse: (value: unknown) => T | null,
    fallback: T
  ): T => {
    for (const key of [perProjectKey, globalKey]) {
      if (!map.has(key)) continue;
      const parsed = parse(map.get(key));
      if (parsed !== null) return parsed;
    }
    return fallback;
  };

  return {
    enabled: pick(
      autoModeEnabledSettingKey(projectId),
      AUTO_MODE_ENABLED_SETTING_KEY,
      parseAutoModeEnabled,
      false
    ),
    buildAgent: pick(
      autoModeBuildAgentSettingKey(projectId),
      AUTO_MODE_BUILD_AGENT_SETTING_KEY,
      parseAutoModeAgent,
      null
    ),
    buildConcurrency: pick(
      autoModeBuildConcurrencySettingKey(projectId),
      AUTO_MODE_BUILD_CONCURRENCY_SETTING_KEY,
      parseAutoModeConcurrency,
      DEFAULT_AUTO_BUILD_CONCURRENCY
    ),
    reviewAgent: pick(
      autoModeReviewAgentSettingKey(projectId),
      AUTO_MODE_REVIEW_AGENT_SETTING_KEY,
      parseAutoModeAgent,
      null
    ),
    reviewConcurrency: pick(
      autoModeReviewConcurrencySettingKey(projectId),
      AUTO_MODE_REVIEW_CONCURRENCY_SETTING_KEY,
      parseAutoModeConcurrency,
      DEFAULT_AUTO_REVIEW_CONCURRENCY
    ),
  };
}

/**
 * Every project that has Full Auto Mode switched on right now.
 *
 * The standing sweep has no request context, so it needs to discover its own
 * work list: any `auto_mode_enabled:<projectId>` row that parses to true.
 * The global key is deliberately NOT a blanket "all projects on" switch —
 * activation is per project (the user's decision), so the global key only
 * acts as the fallback value for a project whose own key is absent, and a
 * project is swept only once its own key exists.
 */
export function listAutoModeEnabledProjectIds(): string[] {
  const prefix = `${AUTO_MODE_ENABLED_SETTING_KEY}:`;
  return db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .all()
    .filter(
      (row) =>
        row.key.startsWith(prefix) && parseAutoModeEnabled(row.value) === true
    )
    .map((row) => row.key.slice(prefix.length))
    .filter((projectId) => projectId.length > 0);
}
