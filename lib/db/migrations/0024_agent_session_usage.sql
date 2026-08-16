-- Token/cost usage reported by the CLI at session end. NULL for legacy rows,
-- non-terminal sessions, and providers that do not report usage.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so like 0023 this cannot be an
-- idempotent no-op. The bookkeeping-less recovery path handles it instead:
-- stampLegacyBaseline (lib/db/init.ts, POST_BASELINE_COLUMN_MIGRATIONS)
-- stamps this migration as applied when the columns already exist.
ALTER TABLE agent_sessions ADD COLUMN input_tokens INTEGER;
--> statement-breakpoint
ALTER TABLE agent_sessions ADD COLUMN output_tokens INTEGER;
--> statement-breakpoint
ALTER TABLE agent_sessions ADD COLUMN total_cost_usd REAL;
