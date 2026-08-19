-- Provenance of a project's working directory.
--
-- `clone_source` is the ownership flag: 'github' means Arij created the
-- directory itself (POST /api/projects/clone) and may therefore be allowed to
-- delete it again. NULL means the user supplied the path, and the directory is
-- never touched by Arij. Existing rows keep NULL and behave exactly as before.
--
-- `git_remote_url` stores the clean clone URL (never credential-bearing) so the
-- UI can link back to the source and a re-clone can reuse it.
-- `default_branch` records the branch the clone reported, so worktree creation
-- no longer has to guess between `main` and `master`.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so like 0023/0024/0026 this cannot be
-- an idempotent no-op. The bookkeeping-less recovery path handles it instead:
-- stampLegacyBaseline (lib/db/init.ts, POST_BASELINE_COLUMN_MIGRATIONS) stamps
-- this migration as applied when the columns already exist.
ALTER TABLE projects ADD COLUMN clone_source text;--> statement-breakpoint
ALTER TABLE projects ADD COLUMN git_remote_url text;--> statement-breakpoint
ALTER TABLE projects ADD COLUMN default_branch text;
