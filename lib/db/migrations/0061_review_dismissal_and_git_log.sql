ALTER TABLE review_comments ADD COLUMN dismissed_reason TEXT;
--> statement-breakpoint
UPDATE git_sync_log SET status = 'failed' WHERE status = 'failure';
--> statement-breakpoint
INSERT OR IGNORE INTO settings (key, value) VALUES ('prompt_token_budget', '30000');
