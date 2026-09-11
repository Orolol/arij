-- Releases: `published_at` and `changelog_session_id` (lot 11, #105 / #109).
--
-- #105. `pushed_at` was stamped when POST /releases created the GitHub DRAFT
-- and again when the publish route made it public, and the UI read
-- "published" off `github_release_id AND pushed_at`. Every draft the app ever
-- created was therefore shown as published and the Publish button never
-- appeared. Publication is now its own column, written only by the publish
-- route; `pushed_at` keeps meaning "tag and draft pushed to GitHub".
ALTER TABLE `releases` ADD `published_at` text;
--> statement-breakpoint
-- Backfill, conservatively. The creation route stamped `pushed_at` a moment
-- before inserting the row (so within seconds of `created_at`); only the
-- publish route could stamp it well after. A row whose push trails its
-- creation by more than a minute went through publish. Anything closer stays
-- a draft: the publish route asks GitHub before publishing and records a
-- release that turns out to be public already, so a wrong "draft" heals on
-- the first click, while a wrong "published" would hide the button forever.
UPDATE `releases`
SET `published_at` = `pushed_at`
WHERE `github_release_id` IS NOT NULL
  AND `pushed_at` IS NOT NULL
  AND `created_at` IS NOT NULL
  AND (julianday(`pushed_at`) - julianday(`created_at`)) * 86400 > 60;
--> statement-breakpoint
-- #109. The release is claimed at once and its changelog written by a
-- background session; the row points at that session so the page can say
-- "changelog in progress" while it runs.
ALTER TABLE `releases` ADD `changelog_session_id` text REFERENCES `agent_sessions`(`id`) ON DELETE set null;
--> statement-breakpoint
-- #109, review. The run's closure lives in process memory: a run cancelled
-- while still queued, or reaped by a restart, never hands its release to the
-- code that tags it. The row therefore carries what finalisation needs —
-- whether to push to GitHub — and when it happened, so GET /releases can
-- finish any claimed release whose run is over and which was never finalised.
ALTER TABLE `releases` ADD `push_to_github` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `releases` ADD `finalized_at` text;
--> statement-breakpoint
-- Every release that predates this migration was finalised synchronously by
-- the request that created it.
UPDATE `releases` SET `finalized_at` = COALESCE(`created_at`, CURRENT_TIMESTAMP);
--> statement-breakpoint
-- What went wrong while finalising (branch, tag push, GitHub draft), as a JSON
-- array. The page reads it on every load; a toast alone is lost to anyone who
-- was not looking at the moment the background step failed.
ALTER TABLE `releases` ADD `finalize_errors` text;
