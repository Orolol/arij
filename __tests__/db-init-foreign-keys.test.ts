/**
 * The migration boundary must disable foreign keys OUTSIDE drizzle's
 * transaction (B-arij-251).
 *
 * Drizzle's sqlite migrator runs `BEGIN` before the whole batch and `COMMIT`
 * after it (drizzle-orm/sqlite-core/dialect.js, `SQLiteSyncDialect.migrate`).
 * SQLite ignores `PRAGMA foreign_keys` while a transaction is open, so the
 * `PRAGMA foreign_keys=OFF` written into a rebuild-and-rename migration
 * (0003, 0012, 0029, 0051) is a no-op: with `foreign_keys = ON` on the
 * connection — which is what lib/db/index.ts sets — the rebuild's
 * `DROP TABLE` fires every cascade hanging off the parent it is rebuilding.
 *
 * These tests drive the real `initDb()` entry point with the real migration
 * chain plus one staged rebuild appended to it, so they exercise the boundary
 * production uses rather than a hand-rolled `migrate()` call.
 */

import fs from "fs";
import Database from "better-sqlite3";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { initDb, defaultMigrationsFolder } from "@/lib/db/init";
import { cleanupTempDirs, tempDbPath, tempDir } from "./helpers/migration";

afterEach(() => {
  cleanupTempDirs();
});

/** A connection configured exactly as lib/db/index.ts configures production. */
function openProductionLike(file: string): Database.Database {
  const connection = new Database(file);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  return connection;
}

function foreignKeysOn(connection: Database.Database): boolean {
  return connection.pragma("foreign_keys", { simple: true }) === 1;
}

type StagedMigration = { tag: string; sql: string };

/**
 * Build a migrations folder drizzle can read: `<tag>.sql` files plus a
 * `meta/_journal.json`. `base` (when given) is copied in first, and the staged
 * migrations are appended after its last entry so they run as pending work on
 * a database that already carries the base chain.
 */
function stageMigrations(
  migrations: StagedMigration[],
  options: { base?: string } = {},
): string {
  const folder = tempDir("arij-fk-migrations-");
  let entries: Array<Record<string, unknown>> = [];
  let lastWhen = 0;

  if (options.base) {
    fs.cpSync(options.base, folder, { recursive: true });
    const journal = JSON.parse(
      fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf-8"),
    ) as { entries: Array<{ when: number }> };
    entries = journal.entries as Array<Record<string, unknown>>;
    lastWhen = Math.max(...journal.entries.map((entry) => entry.when));
  } else {
    fs.mkdirSync(path.join(folder, "meta"), { recursive: true });
  }

  migrations.forEach((migration, index) => {
    fs.writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
    entries.push({
      idx: entries.length,
      version: "6",
      when: lastWhen + 100000 * (index + 1),
      tag: migration.tag,
      breakpoints: true,
    });
  });

  fs.writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2),
  );
  return folder;
}

/**
 * The rebuild-and-rename pattern drizzle emits, reproduced for an arbitrary
 * table by reading its live DDL: create `__new_<table>`, copy every row, drop
 * the original, rename, recreate the indexes the drop took with it.
 *
 * The `PRAGMA foreign_keys=OFF` / `ON` bracket is deliberately kept — it is
 * exactly what the shipped migrations write, and exactly what has no effect
 * inside the migrator's transaction.
 */
function rebuildTableSql(
  connection: Database.Database,
  table: string,
): string {
  const createSql = (
    connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string }
  ).sql;
  const columns = (
    connection.prepare("SELECT name FROM pragma_table_info(?)").all(table) as {
      name: string;
    }[]
  ).map((row) => `"${row.name}"`);
  const indexes = (
    connection
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      )
      .all(table) as { sql: string }[]
  ).map((row) => row.sql);

  // SQLite rewrites the stored DDL on RENAME, so the table name can come back
  // bare, backquoted or double-quoted depending on the migration that made it.
  const newTableSql = createSql.replace(
    new RegExp(`(CREATE TABLE\\s+)(\`|"|\\[)?${table}(\`|"|\\])?`, "i"),
    `$1\`__new_${table}\``,
  );

  return [
    "PRAGMA foreign_keys=OFF;",
    newTableSql,
    `INSERT INTO \`__new_${table}\`(${columns.join(", ")}) SELECT ${columns.join(", ")} FROM \`${table}\`;`,
    `DROP TABLE \`${table}\`;`,
    `ALTER TABLE \`__new_${table}\` RENAME TO \`${table}\`;`,
    ...indexes,
    "PRAGMA foreign_keys=ON;",
  ].join("--> statement-breakpoint\n");
}

/**
 * Populate one `agent_sessions` row and one child row on each of the three
 * link shapes that hang off it in the real schema:
 *   - ON DELETE CASCADE  — agent_session_chunks, agent_session_sequences,
 *                          session_artifacts
 *   - ON DELETE SET NULL — qa_reports
 *   - NO ACTION          — ticket_comments (blocks the delete outright)
 */
function seedSessionGraph(
  connection: Database.Database,
  options: { withNoActionLink: boolean },
): void {
  connection.exec(`
    INSERT INTO projects (id, name) VALUES ('p1', 'FK fixture');
    INSERT INTO epics (id, project_id, title) VALUES ('e1', 'p1', 'Epic');
    INSERT INTO agent_sessions (id, project_id, epic_id, status)
      VALUES ('s1', 'p1', 'e1', 'completed');
    INSERT INTO agent_session_chunks (id, session_id, stream_type, sequence, content)
      VALUES ('c1', 's1', 'stdout', 1, 'hello');
    INSERT INTO agent_session_sequences (session_id, next_sequence)
      VALUES ('s1', 2);
    INSERT INTO session_artifacts (id, agent_session_id, epic_id, filename, caption)
      VALUES ('a1', 's1', 'e1', 'shot.png', 'A screenshot');
    INSERT INTO qa_reports (id, project_id, agent_session_id, status)
      VALUES ('q1', 'p1', 's1', 'completed');
  `);

  if (options.withNoActionLink) {
    connection
      .prepare(
        `INSERT INTO ticket_comments (id, epic_id, agent_session_id, author, content)
         VALUES ('tc1', 'e1', 's1', 'agent', 'note')`,
      )
      .run();
  }
}

function count(connection: Database.Database, sql: string): number {
  return (connection.prepare(sql).get() as { n: number }).n;
}

/** Every child row and link that must survive a rebuild of agent_sessions. */
function sessionGraphCensus(connection: Database.Database) {
  return {
    sessions: count(connection, "SELECT COUNT(*) AS n FROM agent_sessions"),
    chunks: count(connection, "SELECT COUNT(*) AS n FROM agent_session_chunks"),
    sequences: count(
      connection,
      "SELECT COUNT(*) AS n FROM agent_session_sequences",
    ),
    artifacts: count(connection, "SELECT COUNT(*) AS n FROM session_artifacts"),
    qaReportsLinked: count(
      connection,
      "SELECT COUNT(*) AS n FROM qa_reports WHERE agent_session_id = 's1'",
    ),
  };
}

// ---------------------------------------------------------------------------

describe("initDb foreign-key boundary", () => {
  it("keeps cascade children and set-null links when a rebuild of a referenced parent runs", () => {
    const file = tempDbPath();
    const connection = openProductionLike(file);
    try {
      initDb(connection);
      seedSessionGraph(connection, { withNoActionLink: false });

      const before = sessionGraphCensus(connection);
      expect(before).toEqual({
        sessions: 1,
        chunks: 1,
        sequences: 1,
        artifacts: 1,
        qaReportsLinked: 1,
      });

      const folder = stageMigrations(
        [
          {
            tag: "9001_rebuild_agent_sessions",
            sql: rebuildTableSql(connection, "agent_sessions"),
          },
        ],
        { base: defaultMigrationsFolder() },
      );

      initDb(connection, { migrationsFolder: folder });

      expect(sessionGraphCensus(connection)).toEqual(before);
    } finally {
      connection.close();
    }
  });

  it("does not abort a rebuild on a NO ACTION child link", () => {
    const file = tempDbPath();
    const connection = openProductionLike(file);
    try {
      initDb(connection);
      seedSessionGraph(connection, { withNoActionLink: true });

      const folder = stageMigrations(
        [
          {
            tag: "9001_rebuild_agent_sessions",
            sql: rebuildTableSql(connection, "agent_sessions"),
          },
        ],
        { base: defaultMigrationsFolder() },
      );

      expect(() =>
        initDb(connection, { migrationsFolder: folder }),
      ).not.toThrow();

      expect(
        count(
          connection,
          "SELECT COUNT(*) AS n FROM ticket_comments WHERE agent_session_id = 's1'",
        ),
      ).toBe(1);
    } finally {
      connection.close();
    }
  });

  it("leaves foreign keys enforced after a successful migration run", () => {
    const file = tempDbPath();
    const connection = openProductionLike(file);
    try {
      initDb(connection);
      expect(foreignKeysOn(connection)).toBe(true);

      expect(() =>
        connection
          .prepare(
            "INSERT INTO agent_sessions (id, project_id) VALUES ('sx', 'missing-project')",
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      connection.close();
    }
  });

  it("restores the foreign_keys setting when a migration throws", () => {
    const file = tempDbPath();
    const connection = openProductionLike(file);
    try {
      initDb(connection);

      const folder = stageMigrations(
        [{ tag: "9001_broken", sql: "SELECT this_is_not_valid_sql(;" }],
        { base: defaultMigrationsFolder() },
      );

      expect(() => initDb(connection, { migrationsFolder: folder })).toThrow();
      expect(foreignKeysOn(connection)).toBe(true);
    } finally {
      connection.close();
    }
  });

  it("refuses to migrate when the suspension cannot take effect", () => {
    // The defect's own mechanism, one level up: inside an open transaction
    // SQLite ignores `PRAGMA foreign_keys`, so `initDb()` would migrate with
    // cascades armed. It has to notice and refuse instead of proceeding.
    const file = tempDbPath();
    const connection = openProductionLike(file);
    try {
      initDb(connection);
      seedSessionGraph(connection, { withNoActionLink: false });

      const folder = stageMigrations(
        [
          {
            tag: "9001_rebuild_agent_sessions",
            sql: rebuildTableSql(connection, "agent_sessions"),
          },
        ],
        { base: defaultMigrationsFolder() },
      );

      const before = sessionGraphCensus(connection);
      connection.exec("BEGIN");
      try {
        expect(() => initDb(connection, { migrationsFolder: folder })).toThrow(
          /foreign keys could not be suspended/i,
        );
      } finally {
        connection.exec("ROLLBACK");
      }

      expect(sessionGraphCensus(connection)).toEqual(before);
      expect(foreignKeysOn(connection)).toBe(true);
    } finally {
      connection.close();
    }
  });

  it("refuses startup when a migration leaves a foreign-key violation behind", () => {
    const file = tempDbPath();
    const connection = openProductionLike(file);
    try {
      initDb(connection);

      const folder = stageMigrations(
        [
          {
            tag: "9001_orphan_chunk",
            sql: `INSERT INTO agent_session_chunks (id, session_id, stream_type, sequence, content)
                  VALUES ('orphan', 'no-such-session', 'stdout', 1, 'x');`,
          },
        ],
        { base: defaultMigrationsFolder() },
      );

      // Under the suspended-foreign-keys window the orphan insert succeeds,
      // so it is `foreign_key_check` — not SQLite's enforcement — that has to
      // catch it and refuse the boot.
      expect(() => initDb(connection, { migrationsFolder: folder })).toThrow(
        /foreign key violation\(s\) behind; refusing to start/i,
      );
      expect(foreignKeysOn(connection)).toBe(true);
    } finally {
      connection.close();
    }
  });

  it("persists the startup refusal across reopen when a migration left foreign-key violations behind", () => {
    const file = tempDbPath();
    const connection = openProductionLike(file);
    let folder = "";
    try {
      initDb(connection);

      folder = stageMigrations(
        [
          {
            tag: "9001_orphan_chunk",
            sql: `INSERT INTO agent_session_chunks (id, session_id, stream_type, sequence, content)
                  VALUES ('orphan', 'no-such-session', 'stdout', 1, 'x');`,
          },
        ],
        { base: defaultMigrationsFolder() },
      );

      expect(() => initDb(connection, { migrationsFolder: folder })).toThrow(
        /foreign key violation\(s\) behind; refusing to start/i,
      );
    } finally {
      connection.close();
    }

    // Reopening the database on a fresh connection must STILL refuse startup.
    // Drizzle committed the migration entry before foreign_key_check threw,
    // so no new migrations are pending on restart. The validation refusal must
    // not fail open on subsequent boots.
    const connection2 = openProductionLike(file);
    try {
      expect(() => initDb(connection2, { migrationsFolder: folder })).toThrow(
        /foreign key violation\(s\) behind; refusing to start/i,
      );
      expect(foreignKeysOn(connection2)).toBe(true);
    } finally {
      connection2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// A self-contained parent/child fixture: the same boundary, without the real
// schema's noise, covering the three delete actions explicitly.
// ---------------------------------------------------------------------------

describe("initDb foreign-key boundary (minimal fixture)", () => {
  const createFixture = `
CREATE TABLE parent (id text PRIMARY KEY NOT NULL, label text);--> statement-breakpoint
CREATE TABLE child_cascade (
  id text PRIMARY KEY NOT NULL,
  parent_id text NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES parent(id) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE child_set_null (
  id text PRIMARY KEY NOT NULL,
  parent_id text,
  FOREIGN KEY (parent_id) REFERENCES parent(id) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE TABLE child_no_action (
  id text PRIMARY KEY NOT NULL,
  parent_id text,
  FOREIGN KEY (parent_id) REFERENCES parent(id)
);`;

  const rebuildParent = `
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE \`__new_parent\` (id text PRIMARY KEY NOT NULL, label text NOT NULL DEFAULT '');--> statement-breakpoint
INSERT INTO \`__new_parent\`("id", "label") SELECT "id", coalesce("label", '') FROM \`parent\`;--> statement-breakpoint
DROP TABLE \`parent\`;--> statement-breakpoint
ALTER TABLE \`__new_parent\` RENAME TO \`parent\`;--> statement-breakpoint
PRAGMA foreign_keys=ON;`;

  it("preserves cascade, set-null and no-action children across a rebuild", () => {
    const file = tempDbPath();
    const connection = openProductionLike(file);
    try {
      const created = stageMigrations([
        { tag: "0000_create", sql: createFixture },
      ]);
      initDb(connection, { migrationsFolder: created });

      connection.exec(`
        INSERT INTO parent (id, label) VALUES ('p', 'kept');
        INSERT INTO child_cascade (id, parent_id) VALUES ('cc', 'p');
        INSERT INTO child_set_null (id, parent_id) VALUES ('csn', 'p');
        INSERT INTO child_no_action (id, parent_id) VALUES ('cna', 'p');
      `);

      const rebuilt = stageMigrations(
        [
          { tag: "0000_create", sql: createFixture },
          { tag: "0001_rebuild_parent", sql: rebuildParent },
        ],
      );
      initDb(connection, { migrationsFolder: rebuilt });

      expect({
        parents: count(connection, "SELECT COUNT(*) AS n FROM parent"),
        cascade: count(connection, "SELECT COUNT(*) AS n FROM child_cascade"),
        setNull: count(
          connection,
          "SELECT COUNT(*) AS n FROM child_set_null WHERE parent_id = 'p'",
        ),
        noAction: count(
          connection,
          "SELECT COUNT(*) AS n FROM child_no_action WHERE parent_id = 'p'",
        ),
      }).toEqual({ parents: 1, cascade: 1, setNull: 1, noAction: 1 });
    } finally {
      connection.close();
    }
  });
});
