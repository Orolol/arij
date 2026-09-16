-- Migration 0058: Lot 21 usage and database cleanups
-- 1. Finding #3: Drop named_agents.readable_agent_name and unique index
DROP INDEX IF EXISTS `named_agents_readable_agent_name_unique`;
--> statement-breakpoint
ALTER TABLE `named_agents` DROP COLUMN `readable_agent_name`;
--> statement-breakpoint

-- 2. Finding #4: Drop unread columns in epics, github_issues, desk_dismissals, provider_usage_snapshots, sessions
ALTER TABLE `epics` DROP COLUMN `github_issue_url`;
--> statement-breakpoint
ALTER TABLE `epics` DROP COLUMN `github_issue_state`;
--> statement-breakpoint
ALTER TABLE `github_issues` DROP COLUMN `imported_at`;
--> statement-breakpoint
ALTER TABLE `desk_dismissals` DROP COLUMN `dismissed_at`;
--> statement-breakpoint
ALTER TABLE `provider_usage_snapshots` DROP COLUMN `source_file`;
--> statement-breakpoint
ALTER TABLE `agent_sessions` DROP COLUMN `claude_session_id`;
--> statement-breakpoint
ALTER TABLE `chat_conversations` DROP COLUMN `claude_session_id`;
--> statement-breakpoint

-- 3. Finding #6: Normalize ticket_activity_log.created_at to ISO and add index
UPDATE `ticket_activity_log`
SET `created_at` = replace(`created_at`, ' ', 'T') || 'Z'
WHERE `created_at` NOT LIKE '%Z' AND `created_at` LIKE '% %';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ticket_activity_log_to_status_created_at_idx`
ON `ticket_activity_log` (`to_status`, `created_at`);
