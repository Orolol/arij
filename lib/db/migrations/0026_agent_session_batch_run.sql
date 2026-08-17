-- Batch/night run that dispatched this session (see lib/night). NULL for
-- standalone dispatches. Night-run ids carry the 'night_' prefix so the
-- morning summary can be re-derived from the database after a restart.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so like 0023/0024 this cannot be
-- an idempotent no-op. The bookkeeping-less recovery path handles it instead:
-- stampLegacyBaseline (lib/db/init.ts, POST_BASELINE_COLUMN_MIGRATIONS)
-- stamps this migration as applied when the column already exists.
ALTER TABLE agent_sessions ADD COLUMN batch_run_id TEXT;
