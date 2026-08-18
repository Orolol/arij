-- git_sync_log.project_id becomes nullable.
--
-- A clone is logged BEFORE any project row exists: POST /api/projects/clone
-- runs ahead of POST /api/projects, so the audit row for `operation = 'clone'`
-- has no project to point at. With `PRAGMA foreign_keys = ON` (lib/db/index.ts)
-- the NOT NULL + FK pair made those rows impossible to insert — and because
-- logSyncOperation() swallows write failures, they would have vanished
-- silently. Rows that DO belong to a project keep the cascade.
--
-- SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt.
-- No other table references git_sync_log, so the drop/rename is safe.
--
-- Numbered after 0027_project_clone_source (the two land together with the
-- GitHub import): drizzle's migrator only applies files whose journal `when`
-- is greater than the last recorded one, so journal order and `when` order
-- must agree — hence 0028 rather than a second 0027.
CREATE TABLE `git_sync_log_new` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`operation` text NOT NULL,
	`branch` text,
	`status` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `git_sync_log_new` (`id`, `project_id`, `operation`, `branch`, `status`, `detail`, `created_at`)
SELECT `id`, `project_id`, `operation`, `branch`, `status`, `detail`, `created_at` FROM `git_sync_log`;
--> statement-breakpoint
DROP TABLE `git_sync_log`;
--> statement-breakpoint
ALTER TABLE `git_sync_log_new` RENAME TO `git_sync_log`;
