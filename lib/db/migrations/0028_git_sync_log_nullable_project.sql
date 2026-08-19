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
-- ORDERING CONTRACT — drizzle's migrator keeps a single high-water mark (the
-- greatest applied `created_at`) and silently skips any migration whose
-- journal `when` sits below it. This one therefore takes the LAST slot,
-- 1786712500000, above every released migration; idx 26 / `when`
-- 1786712400000 / tag 0027_project_clone_source is left free for the sibling
-- epic that adds the projects columns. Whoever merges next must keep the same
-- rule: append, never backdate.
--
-- Re-running this migration is harmless (a database that applied it under its
-- previous 0027 numbering rebuilds an already-nullable table and keeps its
-- rows), so the renumbering costs nothing but a repeated rebuild.
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
