-- The mcp__arij__* tool calls of a session, indexed as its raw stream is
-- written (#236), and the per-session marker saying the index is complete.
--
-- Written as 0061 on its branch and renumbered 0063 at merge time: main
-- already held 0057-0061 (chat_epic_proposals … review_dismissal_and_git_log)
-- and lot 11 took 0062. The journal `when` was re-stamped above all of theirs
-- — the migrator only applies an entry whose `when` exceeds the last one a
-- database recorded, so the branch's original `when`, which sat under 0061's,
-- would have been skipped silently on any database that had run 0061.
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
