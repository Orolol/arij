/**
 * The harness every migration test needs: a temp database file, a connection
 * that is always closed, and the four SQLite introspection reads.
 *
 * WHY ONE COPY. Six files defined their own `tempDbPath`, nine their own
 * `withDb`, four `columnNames` and two the index pair — byte-identical bodies
 * with different temp-file prefixes. The copies were not merely long: each one
 * was a place where a leak (a connection left open, a temp directory never
 * removed) could be introduced once and go unnoticed in the other eight.
 *
 * The temp directory is registered for cleanup here, so a test file no longer
 * has to keep its own `tempDirs` array — call `cleanupTempDirs()` in
 * `afterAll`, or use `withTempDb()` which owns the whole lifetime.
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

/** Absolute location of the hand-written migrations and their journal. */
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib", "db", "migrations");

/** A fresh temp directory, removed by {@link cleanupTempDirs}. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A path for a database file inside a fresh temp directory. The file does not exist yet. */
export function tempDbPath(prefix = "arij-migration-"): string {
  return path.join(tempDir(prefix), "arij.db");
}

/** Opens `file`, runs `fn`, and closes the connection whatever happens. */
export function withDb<T>(file: string, fn: (conn: Database.Database) => T): T {
  const conn = new Database(file);
  try {
    return fn(conn);
  } finally {
    conn.close();
  }
}

/** Removes every directory {@link tempDir} created. Call from `afterAll`. */
export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* SQLite introspection                                                */
/* ------------------------------------------------------------------ */

export function tableNames(conn: Database.Database): string[] {
  return (
    conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

export function columnNames(conn: Database.Database, table: string): string[] {
  return (
    conn.prepare("SELECT name FROM pragma_table_info(?)").all(table) as {
      name: string;
    }[]
  ).map((row) => row.name);
}

export function indexList(conn: Database.Database, table: string): string[] {
  return (
    conn.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]
  ).map((row) => row.name);
}

export function indexColumns(conn: Database.Database, name: string): string[] {
  return (
    conn.prepare(`PRAGMA index_info(${name})`).all() as {
      seqno: number;
      name: string;
    }[]
  )
    .sort((a, b) => a.seqno - b.seqno)
    .map((row) => row.name);
}

/** The migration timestamps the migrator has stamped, ascending. */
export function appliedMigrationTimestamps(conn: Database.Database): number[] {
  return (
    conn
      .prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at')
      .all() as { created_at: number }[]
  ).map((row) => row.created_at);
}

/**
 * Opens a FRESH temp database, runs `initDb` on it, and hands the connection
 * to `fn`. The variant three migration suites had pasted: each created its own
 * temp directory and applied the full migration chain before asserting one
 * migration's effect.
 *
 * `initDb` is imported lazily because `lib/db/init.ts` reads the migrations
 * folder at call time and pulling it into this module's scope would make every
 * importer of the harness depend on it.
 */
export async function withMigratedDb<T>(
  fn: (conn: Database.Database) => T,
  prefix = "arij-migration-",
): Promise<T> {
  const { initDb, defaultMigrationsFolder } = await import("@/lib/db/init");
  const file = tempDbPath(prefix);
  const conn = new Database(file);
  try {
    initDb(conn, { migrationsFolder: defaultMigrationsFolder() });
    return fn(conn);
  } finally {
    conn.close();
  }
}
