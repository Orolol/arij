-- Notifications feed + single-row read cursor (moved from ad-hoc bootstrap DDL
-- in lib/db/index.ts). IF NOT EXISTS keeps this a no-op on databases where the
-- ad-hoc DDL already created the objects.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  agent_type TEXT,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  target_url TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at);
--> statement-breakpoint

-- Single-row read cursor (id always 1)
CREATE TABLE IF NOT EXISTS notification_read_cursor (
  id INTEGER PRIMARY KEY,
  read_at TEXT NOT NULL
);
