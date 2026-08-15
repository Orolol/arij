-- Ticket activity audit log (moved from ad-hoc bootstrap DDL in lib/db/index.ts).
-- IF NOT EXISTS keeps this a no-op on databases where the ad-hoc DDL already
-- created the objects.
CREATE TABLE IF NOT EXISTS ticket_activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  session_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ticket_activity_log_epic_idx ON ticket_activity_log(epic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ticket_activity_log_project_idx ON ticket_activity_log(project_id);
