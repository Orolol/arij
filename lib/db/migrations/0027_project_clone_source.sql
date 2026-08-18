-- Provenance of projects.git_repo_path.
--
-- clone_source is 'github' only when Arij itself created the directory (the
-- clone flow); it stays NULL for user-supplied paths, which Arij must never
-- offer to delete. git_remote_url keeps the clean clone URL — never the
-- tokenised one — and default_branch the branch reported by the clone, used
-- instead of the main/master guess.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so like 0023/0024/0026 this cannot
-- be an idempotent no-op. The bookkeeping-less recovery path handles it
-- instead: stampLegacyBaseline (lib/db/init.ts, POST_BASELINE_COLUMN_MIGRATIONS)
-- stamps this migration as applied when the columns already exist.
--
-- Hand-written: `drizzle-kit generate` must not be run on this repo (the
-- meta/*_snapshot.json files stop at 0013 while the journal is at 0026, so
-- generate would emit a diff against a stale snapshot).
ALTER TABLE projects ADD COLUMN clone_source TEXT;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN git_remote_url TEXT;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN default_branch TEXT;
