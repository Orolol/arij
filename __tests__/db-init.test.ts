/**
 * Tests for explicit database initialization (lib/db/init.ts) and the
 * side-effect-free lazy connection module (lib/db/index.ts).
 *
 * Covers the three database states initDb() must handle:
 *  - fresh file                      -> full migration chain
 *  - legacy push-created database    -> baseline stamping, no re-migration
 *  - ad-hoc-bootstrapped database    -> chain applies around existing objects
 */

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  DEFAULT_NAMED_AGENT_MODEL,
  DEFAULT_NAMED_AGENT_NAME,
  DEFAULT_NAMED_AGENT_PROVIDER,
  LEGACY_BASELINE_MS,
  initDb,
} from "@/lib/db/init";
import * as schema from "@/lib/db/schema";

const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib", "db", "migrations");

const journal = JSON.parse(
  fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf-8")
) as { entries: { when: number; tag: string }[] };

const TOTAL_MIGRATIONS = journal.entries.length;

/** SQL tables declared in schema.ts. */
const schemaTables = (Object.values(schema) as unknown[]).filter(
  (value): value is SQLiteTable => is(value, SQLiteTable)
);

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-init-test-"));
  tempDirs.push(dir);
  return path.join(dir, "arij.db");
}

function withDb<T>(file: string, fn: (conn: Database.Database) => T): T {
  const conn = new Database(file);
  try {
    return fn(conn);
  } finally {
    conn.close();
  }
}

function tableNames(conn: Database.Database): string[] {
  return (
    conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function columnNames(conn: Database.Database, table: string): string[] {
  return (
    conn.prepare("SELECT name FROM pragma_table_info(?)").all(table) as {
      name: string;
    }[]
  ).map((row) => row.name);
}

function appliedMigrationTimestamps(conn: Database.Database): number[] {
  return (
    conn
      .prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at')
      .all() as { created_at: number }[]
  ).map((row) => Number(row.created_at));
}

function seedRows(conn: Database.Database) {
  return conn
    .prepare("SELECT name, provider, model FROM named_agents WHERE name = ?")
    .all(DEFAULT_NAMED_AGENT_NAME) as {
    name: string;
    provider: string;
    model: string;
  }[];
}

function expectFullSchema(conn: Database.Database): void {
  const tables = tableNames(conn);
  for (const table of schemaTables) {
    const sqlName = getTableName(table);
    expect(tables, `missing table ${sqlName}`).toContain(sqlName);
    const dbColumns = columnNames(conn, sqlName);
    for (const column of Object.values(getTableColumns(table))) {
      expect(dbColumns, `missing column ${sqlName}.${column.name}`).toContain(
        column.name
      );
    }
  }
}

/**
 * The exact bootstrap DDL the old lib/db/index.ts ran at import time.
 * Reproduces the state of a database that only ever saw that code path
 * (three tables, no core schema, no seed).
 */
function applyLegacyAdHocDdl(conn: Database.Database): void {
  conn.exec(`
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
  conn.exec(
    `CREATE INDEX IF NOT EXISTS ticket_activity_log_epic_idx ON ticket_activity_log(epic_id)`
  );
  conn.exec(
    `CREATE INDEX IF NOT EXISTS ticket_activity_log_project_idx ON ticket_activity_log(project_id)`
  );
  conn.exec(`
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
  conn.exec(
    `CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at)`
  );
  conn.exec(`
    CREATE TABLE IF NOT EXISTS notification_read_cursor (
      id INTEGER PRIMARY KEY,
      read_at TEXT NOT NULL
    )
  `);
}

// ---------------------------------------------------------------------------
// initDb() scenarios
// ---------------------------------------------------------------------------

describe("initDb", () => {
  it("builds the full schema on a fresh database", () => {
    const file = tempDbPath();

    withDb(file, (conn) => {
      initDb(conn);

      expectFullSchema(conn);

      const applied = appliedMigrationTimestamps(conn);
      expect(applied).toHaveLength(TOTAL_MIGRATIONS);
      // The two runtime migrations that replaced the ad-hoc bootstrap DDL.
      expect(applied).toContain(1786711800000);
      expect(applied).toContain(1786711900000);

      const seeds = seedRows(conn);
      expect(seeds).toHaveLength(1);
      expect(seeds[0]).toEqual({
        name: DEFAULT_NAMED_AGENT_NAME,
        provider: DEFAULT_NAMED_AGENT_PROVIDER,
        model: DEFAULT_NAMED_AGENT_MODEL,
      });
    });
  });

  it("is idempotent when run repeatedly on the same database", () => {
    const file = tempDbPath();

    withDb(file, (conn) => {
      initDb(conn);
      initDb(conn);
      initDb(conn);

      expect(appliedMigrationTimestamps(conn)).toHaveLength(TOTAL_MIGRATIONS);
      expect(seedRows(conn)).toHaveLength(1);
    });
  });

  it("baseline-stamps a legacy push-created database instead of re-running migrations", () => {
    const file = tempDbPath();

    // Build a complete database, then erase drizzle's bookkeeping to simulate
    // a database whose schema came from `drizzle-kit push` + the old ad-hoc
    // DDL (all tables + seed present, no __drizzle_migrations).
    withDb(file, (conn) => {
      initDb(conn);
      conn.exec('DROP TABLE "__drizzle_migrations"');
    });

    withDb(file, (conn) => {
      // Plain CREATE TABLE statements in the early chain would throw here if
      // the chain were actually re-executed.
      expect(() => initDb(conn)).not.toThrow();

      const applied = appliedMigrationTimestamps(conn);
      expect(applied).toHaveLength(TOTAL_MIGRATIONS);
      // Baseline rows were stamped, post-baseline migrations actually ran.
      expect(applied.filter((ms) => ms <= LEGACY_BASELINE_MS)).toHaveLength(
        journal.entries.filter((entry) => entry.when <= LEGACY_BASELINE_MS).length
      );

      expectFullSchema(conn);
      expect(seedRows(conn)).toHaveLength(1);
    });
  });

  it("runs column-adding migrations on legacy databases that lack the columns", () => {
    const file = tempDbPath();

    // Simulate a push-created database from before 0023: full schema minus
    // bookkeeping, with every post-baseline column removed again. (All of
    // them must go — leaving a newer column in place would legitimately
    // raise the stamp ceiling past the older column migrations.)
    withDb(file, (conn) => {
      initDb(conn);
      conn.exec('DROP TABLE "__drizzle_migrations"');
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN outcome");
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN input_tokens");
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN output_tokens");
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN total_cost_usd");
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN batch_run_id");
      conn.exec("ALTER TABLE projects DROP COLUMN clone_source");
      conn.exec("ALTER TABLE projects DROP COLUMN git_remote_url");
      conn.exec("ALTER TABLE projects DROP COLUMN default_branch");
    });

    withDb(file, (conn) => {
      expect(() => initDb(conn)).not.toThrow();

      // The column migrations were not stamped away — they actually ran.
      expect(columnNames(conn, "agent_sessions")).toContain("outcome");
      expect(columnNames(conn, "agent_sessions")).toContain("input_tokens");
      expect(columnNames(conn, "agent_sessions")).toContain("output_tokens");
      expect(columnNames(conn, "agent_sessions")).toContain("total_cost_usd");
      expect(columnNames(conn, "agent_sessions")).toContain("batch_run_id");
      expect(columnNames(conn, "projects")).toContain("clone_source");
      expect(columnNames(conn, "projects")).toContain("git_remote_url");
      expect(columnNames(conn, "projects")).toContain("default_branch");
      expect(appliedMigrationTimestamps(conn)).toHaveLength(TOTAL_MIGRATIONS);
      expectFullSchema(conn);
    });
  });

  it("stamps up to the newest present column and runs the rest (legacy DB at 0023)", () => {
    const file = tempDbPath();

    // Simulate a bookkeeping-less database whose schema stops at 0023:
    // outcome exists; the 0024 usage columns, the 0025 table, the 0026
    // batch_run_id column and the 0027 projects columns do not.
    withDb(file, (conn) => {
      initDb(conn);
      conn.exec('DROP TABLE "__drizzle_migrations"');
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN input_tokens");
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN output_tokens");
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN total_cost_usd");
      conn.exec("ALTER TABLE agent_sessions DROP COLUMN batch_run_id");
      conn.exec("ALTER TABLE projects DROP COLUMN clone_source");
      conn.exec("ALTER TABLE projects DROP COLUMN git_remote_url");
      conn.exec("ALTER TABLE projects DROP COLUMN default_branch");
      conn.exec("DROP TABLE ticket_read_cursors");
    });

    withDb(file, (conn) => {
      // 0023's ALTER must be stamped (outcome exists — re-running would
      // throw) while 0024/0025/0026/0027 actually run.
      expect(() => initDb(conn)).not.toThrow();

      expect(columnNames(conn, "agent_sessions")).toContain("input_tokens");
      expect(columnNames(conn, "agent_sessions")).toContain("output_tokens");
      expect(columnNames(conn, "agent_sessions")).toContain("total_cost_usd");
      expect(columnNames(conn, "agent_sessions")).toContain("batch_run_id");
      expect(columnNames(conn, "projects")).toContain("clone_source");
      expect(tableNames(conn)).toContain("ticket_read_cursors");
      expect(appliedMigrationTimestamps(conn)).toHaveLength(TOTAL_MIGRATIONS);
      expectFullSchema(conn);
    });
  });

  it("migrates a database bootstrapped only by the old ad-hoc DDL (pre-refactor data/arij.db state)", () => {
    const file = tempDbPath();

    withDb(file, (conn) => {
      applyLegacyAdHocDdl(conn);
      expect(tableNames(conn)).toEqual([
        "notification_read_cursor",
        "notifications",
        "ticket_activity_log",
      ]);

      initDb(conn);

      expectFullSchema(conn);
      expect(appliedMigrationTimestamps(conn)).toHaveLength(TOTAL_MIGRATIONS);
      expect(seedRows(conn)).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// lib/db/index.ts import behavior
// ---------------------------------------------------------------------------

describe("lib/db module import", () => {
  it("does not open a database or create the data directory at import time", async () => {
    const originalCwd = process.cwd();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-import-test-"));
    tempDirs.push(dir);

    vi.resetModules();
    try {
      process.chdir(dir);
      await import("@/lib/db");
      expect(fs.existsSync(path.join(dir, "data"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      vi.resetModules();
    }
  });
});
