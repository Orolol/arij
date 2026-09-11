-- The mcp__arij__* tool calls of a session, indexed as its raw stream is
-- written (#236), and the per-session marker saying the index is complete.
--
-- Numbered 0061 rather than 0057: main's parallel work already holds
-- 0057-0060 (chat_epic_proposals … drop_notifications) and another lot holds
-- a 0057 of its own, so this file keeps a slot nothing else claims. The
-- journal `when` is past all of theirs for the same reason — the migrator only
-- applies an entry whose `when` exceeds the last one a database recorded.
-- MERGE ORDER MATTERS: a database that records this `when` before one of
-- those lower-`when` migrations reaches it will skip that one silently. Merge
-- after them, or re-stamp this entry above main's last `when` at merge time.
--
-- All statements are IF NOT EXISTS, so no entry in init.ts's
-- POST_BASELINE_COLUMN_MIGRATIONS: a legacy database re-runs this harmlessly.
CREATE TABLE IF NOT EXISTS `agent_session_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`tool` text NOT NULL,
	`at` text,
	`call_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `agent_session_tool_calls_session_sequence_unique` ON `agent_session_tool_calls` (`session_id`,`sequence`);
--> statement-breakpoint
-- Partial: only ids unique across runs are stored (see schema.ts, callId).
CREATE UNIQUE INDEX IF NOT EXISTS `agent_session_tool_calls_session_call_id_unique` ON `agent_session_tool_calls` (`session_id`,`call_id`) WHERE `call_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_session_tool_call_index` (
	`session_id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
