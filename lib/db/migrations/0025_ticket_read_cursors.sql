-- Per-epic read cursor for ticket activity/comments. Single-user local app:
-- one cursor row per epic, everything up to last_read_at counts as read.
-- IF NOT EXISTS keeps this a no-op on databases that already have the table.
CREATE TABLE IF NOT EXISTS ticket_read_cursors (
  epic_id TEXT PRIMARY KEY,
  last_read_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
