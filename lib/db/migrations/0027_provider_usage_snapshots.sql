-- Latest provider-reported rate-limit snapshot, one row per provider.
-- Today only codex writes rows (parsed from ~/.codex/sessions rollout files);
-- claude has no account-level quota API in headless mode, so it never gets a
-- row — its subscription card is metered from Arij's own agent_sessions.
--
-- captured_at is the PROVIDER EVENT timestamp (ISO-8601 UTC) of the parsed
-- rate_limits line, never the scan time: the UI shows "captured Xh ago" from
-- it and must not lie about freshness. resets_at columns are unix SECONDS,
-- exactly as emitted by codex. raw_json keeps the whole rate_limits object
-- for forward-compat.
--
-- New table (no ALTER), so unlike 0023/0024/0026 this needs NO entry in
-- POST_BASELINE_COLUMN_MIGRATIONS (lib/db/init.ts). Like every other
-- post-baseline CREATE TABLE migration (0021/0022/0025), IF NOT EXISTS keeps
-- this a no-op on bookkeeping-less databases that already carry the table —
-- init.ts's stamp ceiling stops at 0026's column, so this migration re-runs
-- there.
CREATE TABLE IF NOT EXISTS `provider_usage_snapshots` (
	`provider` text PRIMARY KEY NOT NULL,
	`captured_at` text NOT NULL,
	`plan_type` text,
	`primary_used_percent` real,
	`primary_window_minutes` integer,
	`primary_resets_at` integer,
	`secondary_used_percent` real,
	`secondary_window_minutes` integer,
	`secondary_resets_at` integer,
	`source_file` text,
	`raw_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
