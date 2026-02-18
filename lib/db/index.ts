import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { nanoid } from "nanoid";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "arij.db");
export const sqlite = new Database(dbPath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Ensure ticket_activity_log table exists (drizzle-kit push may not run cleanly)
sqlite.exec(`
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
  )
`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS ticket_activity_log_epic_idx ON ticket_activity_log(epic_id)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS ticket_activity_log_project_idx ON ticket_activity_log(project_id)`);

// Ensure notifications table exists
sqlite.exec(`
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
  )
`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at)`);

// Ensure notification_read_cursor table exists (single-row design, id always 1)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS notification_read_cursor (
    id INTEGER PRIMARY KEY,
    read_at TEXT NOT NULL
  )
`);

// Ensure release_id column exists on epics (added after initial schema)
try {
  sqlite.exec(`ALTER TABLE epics ADD COLUMN release_id TEXT REFERENCES releases(id) ON DELETE SET NULL`);
} catch {
  // Column already exists — ignore
}

export const db = drizzle(sqlite, { schema });

// ---------------------------------------------------------------------------
// Seed global default named agent (idempotent, uses raw sqlite to avoid
// circular dependency with lib/agent-config/providers.ts)
// ---------------------------------------------------------------------------
{
  const existing = sqlite
    .prepare("SELECT id FROM named_agents WHERE name = ? LIMIT 1")
    .get("Claude Code") as { id: string } | undefined;

  if (!existing) {
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO named_agents (id, name, provider, model, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
      )
      .run(nanoid(12), "Claude Code", "claude-code", "claude-opus-4-6");
  }
}

// ---------------------------------------------------------------------------
// Backfill readable IDs and agent names (idempotent, no-op when already done)
// ---------------------------------------------------------------------------
{
  try {
    const { backfillReadableIds } = require("./backfill");
    const { backfillAgentNames } = require("../identity");
    backfillReadableIds();
    backfillAgentNames();
  } catch {
    // Silently ignore — columns may not exist during build or before migration
  }
}

// ---------------------------------------------------------------------------
// Backfill: fix raw opencode JSON stored in comments/messages (idempotent)
// ---------------------------------------------------------------------------
{
  try {
    const { backfillOpenCodeJson } = require("./backfill-opencode-json");
    const result = backfillOpenCodeJson(sqlite);
    const total = result.commentsFixed + result.messagesFixed + result.sessionsFixed + result.chunksFixed + result.qaReportsFixed;
    if (total > 0) {
      console.log(
        `[backfill] Fixed opencode JSON: ${result.commentsFixed} comments, ${result.messagesFixed} messages, ${result.sessionsFixed} sessions, ${result.chunksFixed} chunks, ${result.qaReportsFixed} QA reports`
      );
    }
  } catch {
    // Silently ignore
  }
}

// ---------------------------------------------------------------------------
// Backfill: populate releaseId for released epics from releases.epicIds (idempotent)
// ---------------------------------------------------------------------------
{
  try {
    const { backfillReleasedEpicIds } = require("./backfill-release-ids");
    const result = backfillReleasedEpicIds();
    if (result.updated > 0) {
      console.log(`[backfill] Populated releaseId for ${result.updated} released epics`);
    }
  } catch {
    // Silently ignore — columns may not exist during build or before migration
  }
}
