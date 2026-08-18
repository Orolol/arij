-- Provenance of `projects.git_repo_path`. `clone_source = 'github'` marks a
-- directory Arij created itself through POST /api/projects/clone; NULL means
-- the user supplied an already-existing path, which Arij must never offer to
-- delete. `git_remote_url` keeps the clean clone URL (no credentials) and
-- `default_branch` records the branch the clone reported, so the worktree and
-- release code stops guessing between main and master.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so like 0023/0024/0026 this cannot be
-- an idempotent no-op. The bookkeeping-less recovery path handles it instead:
-- stampLegacyBaseline (lib/db/init.ts, POST_BASELINE_COLUMN_MIGRATIONS) stamps
-- this migration as applied when the columns already exist.
ALTER TABLE projects ADD COLUMN clone_source TEXT;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN git_remote_url TEXT;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN default_branch TEXT;
