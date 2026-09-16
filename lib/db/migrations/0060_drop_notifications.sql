-- Removes the notifications subsystem (0022, extended by 0031).
--
-- Both tables were write-only: the API had two routes, GET /api/notifications
-- and POST /api/notifications/read, and no product surface ever fetched them
-- (the bell reads /api/inbox, built from ticket_comments and agent_sessions).
-- Product decision (2026-09-11): remove the whole chain. The signals that
-- used to write here now land on the inbox (CI watch failures, autofix ready),
-- on the project webhook (routine failures, session outcomes), or on the desk
-- which already derives the state from the session rows (stalled, merge
-- parked, memory writes, night runs).
DROP TABLE IF EXISTS notifications;
--> statement-breakpoint
DROP TABLE IF EXISTS notification_read_cursor;
