import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "./schema";
import { initDb } from "./init";

/**
 * Side-effect-free database module.
 *
 * Importing `{ db, sqlite }` performs NO I/O: no file is opened, no SQL runs.
 * The connection is created — and migrations + seeds applied via
 * `initDb()` — lazily on first actual use, memoized per process.
 *
 * `ensureDbReady()` forces that initialization eagerly; instrumentation.ts
 * calls it once at server startup so requests never pay the migration cost.
 */

export type ArijDatabase = BetterSQLite3Database<typeof schema>;

let _sqlite: Database.Database | null = null;
let _db: ArijDatabase | null = null;

function createConnection(): Database.Database {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const connection = new Database(path.join(dataDir, "arij.db"));
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  return connection;
}

function getSqlite(): Database.Database {
  if (!_sqlite) {
    const connection = createConnection();
    try {
      initDb(connection);
    } catch (error) {
      connection.close();
      throw error;
    }
    _sqlite = connection;
    _db = drizzle(connection, { schema });
  }
  return _sqlite;
}

function getDb(): ArijDatabase {
  getSqlite();
  return _db as ArijDatabase;
}

/**
 * Open the connection and run migrations + seeds now (idempotent, memoized).
 * Called from instrumentation.ts at server startup; safe to call anywhere.
 */
export function ensureDbReady(): void {
  getSqlite();
}

/**
 * Lazy pass-through proxy: resolves the real instance on first member access,
 * so importing this module stays free of side effects.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy(Object.create(null) as T, {
    get(_target, prop) {
      const instance = resolve();
      const value = Reflect.get(instance as object, prop, instance) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(instance)
        : value;
    },
    set(_target, prop, value) {
      Reflect.set(resolve() as object, prop, value);
      return true;
    },
    has(_target, prop) {
      return Reflect.has(resolve() as object, prop);
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(resolve());
    },
  });
}

export const sqlite: Database.Database = lazy(getSqlite);
export const db: ArijDatabase = lazy(getDb);
