-- Let the clone audit trail exist before the project does.
--
-- A first-time import clones the repository *before* POST /api/projects runs,
-- so at the moment there is something worth auditing there is no project row to
-- attach it to. With `project_id` NOT NULL the only options were to drop the
-- record or invent an owner, and the audit trail silently missed almost every
-- clone it existed to capture. It is nullable now: pre-project operations are
-- logged with NULL and the cascade still cleans up the rest.
--
-- SQLite cannot drop a NOT NULL constraint in place, so this is the usual
-- rebuild-and-rename, following 0003 and 0012. Re-running it is harmless: the
-- second pass copies an already-migrated table into an identical shape.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_git_sync_log` (
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
INSERT INTO `__new_git_sync_log`("id", "project_id", "operation", "branch", "status", "detail", "created_at") SELECT "id", "project_id", "operation", "branch", "status", "detail", "created_at" FROM `git_sync_log`;--> statement-breakpoint
DROP TABLE `git_sync_log`;--> statement-breakpoint
ALTER TABLE `__new_git_sync_log` RENAME TO `git_sync_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
