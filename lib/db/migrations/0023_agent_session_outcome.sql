-- Delivery verdict: deterministic classification of how an agent session ended.
-- Values: 'answered' | 'asked_question' | 'silent' | 'error'.
-- NULL for legacy rows, non-terminal sessions, and user-cancelled sessions.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so unlike the other post-baseline
-- migrations this one cannot be an idempotent no-op. The bookkeeping-less
-- recovery path handles it instead: stampLegacyBaseline (lib/db/init.ts,
-- POST_BASELINE_COLUMN_MIGRATIONS) stamps this migration as applied when the
-- column already exists.
ALTER TABLE agent_sessions ADD COLUMN outcome TEXT;
