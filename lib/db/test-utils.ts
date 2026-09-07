import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { defaultMigrationsFolder } from "./init";

/**
 * Serialized snapshot of an in-memory database with the full migration chain
 * applied. Built once per process, then cloned for each `createTestDb()` call
 * so tests stay fast and fully isolated.
 *
 * The schema comes from the real drizzle migrations in `lib/db/migrations/` —
 * the same chain production databases run — so tests can never drift from the
 * deployed schema the way hand-maintained DDL could.
 *
 * `migrate()` is called directly rather than through `initDb()`: this builds an
 * EMPTY database whose connection never enables foreign keys, so there is no
 * row for a rebuild migration's DROP TABLE to cascade into and nothing for
 * `initDb`'s foreign-key boundary to protect. Any code path that migrates a
 * database holding data must go through `initDb()` instead — see
 * `migrateWithForeignKeysSuspended` in lib/db/init.ts.
 */
let migratedTemplate: Buffer | null = null;

function buildMigratedTemplate(): Buffer {
  const template = new Database(":memory:");
  try {
    migrate(drizzle(template), { migrationsFolder: defaultMigrationsFolder() });
    return template.serialize();
  } finally {
    template.close();
  }
}

/**
 * Creates an isolated in-memory SQLite database with the full Arij schema.
 *
 * Each call returns a fresh `:memory:` database so tests never interfere
 * with each other or with the production data directory.
 *
 * @returns `{ db, sqlite }` where `db` is a Drizzle ORM instance and
 *          `sqlite` is the underlying better-sqlite3 `Database` handle.
 */
export function createTestDb() {
  migratedTemplate ??= buildMigratedTemplate();
  const sqlite = new Database(migratedTemplate);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
