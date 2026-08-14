-- Push-parity bridge: objects that historically only ever existed because
-- `drizzle-kit push` synced schema.ts straight to the database, and were never
-- captured in a generated migration. Added so the journaled chain alone can
-- produce a complete, working schema on a fresh database.
--
-- Positioned before the legacy baseline (see LEGACY_BASELINE_MS in
-- lib/db/init.ts): databases that already got these objects from push are
-- baseline-stamped and never execute this file.

-- Legacy CLI session columns (kept for resolveCliSessionId(), see schema.ts)
ALTER TABLE `agent_sessions` ADD `claude_session_id` text;
--> statement-breakpoint
ALTER TABLE `chat_conversations` ADD `claude_session_id` text;
--> statement-breakpoint

-- Agent metadata columns on sessions
ALTER TABLE `agent_sessions` ADD `agent_type` text;
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `named_agent_name` text;
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `model` text;
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `cli_command` text;
--> statement-breakpoint

-- Drop pre-registry document columns (superseded by original_filename /
-- markdown_content in 0014_project_document_registry, absent from schema.ts;
-- their NOT NULL constraints would break inserts on chain-built databases)
ALTER TABLE `documents` DROP COLUMN `name`;
--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `content_md`;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `qa_prompts` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `prompt` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `qa_prompts_name_unique` ON `qa_prompts` (`name`);
--> statement-breakpoint

-- check_type is added later by 0017_qa_e2e_check_type
CREATE TABLE IF NOT EXISTS `qa_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES projects(id) ON DELETE cascade,
  `status` text NOT NULL DEFAULT 'running',
  `agent_session_id` text REFERENCES agent_sessions(id) ON DELETE set null,
  `named_agent_id` text REFERENCES named_agents(id) ON DELETE set null,
  `prompt_used` text,
  `custom_prompt_id` text,
  `report_content` text,
  `summary` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP,
  `completed_at` text
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `ticket_dependencies` (
  `id` text PRIMARY KEY NOT NULL,
  `ticket_id` text NOT NULL REFERENCES epics(id) ON DELETE cascade,
  `depends_on_ticket_id` text NOT NULL REFERENCES epics(id) ON DELETE cascade,
  `project_id` text NOT NULL REFERENCES projects(id) ON DELETE cascade,
  `scope_type` text NOT NULL DEFAULT 'project',
  `scope_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ticket_dependencies_edge_unique` ON `ticket_dependencies` (`ticket_id`,`depends_on_ticket_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ticket_dependencies_ticket_idx` ON `ticket_dependencies` (`ticket_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ticket_dependencies_depends_on_idx` ON `ticket_dependencies` (`depends_on_ticket_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ticket_dependencies_project_idx` ON `ticket_dependencies` (`project_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `review_comments` (
  `id` text PRIMARY KEY NOT NULL,
  `epic_id` text NOT NULL REFERENCES epics(id) ON DELETE cascade,
  `file_path` text NOT NULL,
  `line_number` integer NOT NULL,
  `body` text NOT NULL,
  `author` text NOT NULL DEFAULT 'user',
  `status` text NOT NULL DEFAULT 'open',
  `created_at` text DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `review_comments_epic_file_idx` ON `review_comments` (`epic_id`,`file_path`);
