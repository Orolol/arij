/**
 * Migration 0057_release_published_at (lot 11, #105 / #109).
 *
 * `pushed_at` was stamped both when a GitHub draft was created and when it was
 * published, so the UI could not tell them apart and classed every draft as
 * published. The migration adds `published_at` and backfills it only for rows
 * whose push clearly trails their creation — the publish route's signature.
 */
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { initDb } from "@/lib/db/init";

const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib", "db", "migrations");
const MIGRATION_TAG = "0057_release_published_at";

const journal = JSON.parse(
  fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf-8")
) as { entries: { idx: number; when: number; tag: string }[] };

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function columnNames(conn: Database.Database, table: string): string[] {
  return (
    conn.prepare("SELECT name FROM pragma_table_info(?)").all(table) as {
      name: string;
    }[]
  ).map((row) => row.name);
}

/** The `releases` table as it stood at 0056, plus the table the FK targets. */
function preMigrationDb(): Database.Database {
  const conn = new Database(":memory:");
  conn.exec(`
    CREATE TABLE agent_sessions (id text PRIMARY KEY);
    CREATE TABLE releases (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      version text NOT NULL,
      title text,
      changelog text,
      epic_ids text,
      release_branch text,
      git_tag text,
      github_release_id integer,
      github_release_url text,
      pushed_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return conn;
}

function applyMigration(conn: Database.Database) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${MIGRATION_TAG}.sql`), "utf-8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    conn.exec(statement);
  }
}

describe("0057_release_published_at", () => {
  it("is the journal's last entry, in apply order", () => {
    // Renumber it (file, idx, `when`) when merging behind newer migrations:
    // drizzle applies only a `when` above the last one a database recorded.
    expect(journal.entries.at(-1)?.tag).toBe(MIGRATION_TAG);
    const whens = journal.entries.map((e) => e.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(new Set(whens).size).toBe(whens.length);
    const idxs = journal.entries.map((e) => e.idx);
    expect(idxs).toEqual(idxs.map((_, i) => i));
  });

  it("adds its columns on a fresh database", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-published-at-"));
    tempDirs.push(dir);
    const conn = new Database(path.join(dir, "arij.db"));
    try {
      initDb(conn);
      const cols = columnNames(conn, "releases");
      expect(cols).toContain("published_at");
      expect(cols).toContain("changelog_session_id");
      expect(cols).toContain("push_to_github");
      expect(cols).toContain("finalized_at");
      expect(cols).toContain("finalize_errors");
    } finally {
      conn.close();
    }
  });

  it("backfills only releases whose push trails their creation (the publish route's stamp)", () => {
    const conn = preMigrationDb();
    const insert = conn.prepare(
      `INSERT INTO releases (id, project_id, version, github_release_id, pushed_at, created_at)
       VALUES (?, 'p', '1.0.0', ?, ?, ?)`
    );
    // Created as a draft: pushed a moment before the row was written.
    insert.run("draft", 1, "2026-08-01T10:00:00.000Z", "2026-08-01T10:00:00.412Z");
    // Published two days after creation.
    insert.run("published", 2, "2026-08-03T09:00:00.000Z", "2026-08-01T10:00:00.000Z");
    // Local only.
    insert.run("local", null, null, "2026-08-01T10:00:00.000Z");
    // Legacy CURRENT_TIMESTAMP creation stamp, published a day later.
    insert.run("legacy", 3, "2026-08-02T10:00:00.000Z", "2026-08-01 10:00:00");

    applyMigration(conn);

    const rows = Object.fromEntries(
      (
        conn.prepare("SELECT id, published_at FROM releases").all() as {
          id: string;
          published_at: string | null;
        }[]
      ).map((r) => [r.id, r.published_at])
    );
    expect(rows).toEqual({
      draft: null,
      published: "2026-08-03T09:00:00.000Z",
      local: null,
      legacy: "2026-08-02T10:00:00.000Z",
    });
    conn.close();
  });
});

describe("0057_release_published_at — finalisation", () => {
  it("marks every existing release finalised: the creating request did it synchronously", () => {
    const conn = preMigrationDb();
    conn
      .prepare(
        `INSERT INTO releases (id, project_id, version, created_at) VALUES (?, 'p', ?, ?)`
      )
      .run("old", "1.0.0", "2026-08-01T10:00:00.000Z");
    conn
      .prepare(`INSERT INTO releases (id, project_id, version, created_at) VALUES (?, 'p', ?, NULL)`)
      .run("undated", "1.0.1");

    applyMigration(conn);

    const rows = conn
      .prepare("SELECT id, finalized_at, push_to_github, finalize_errors FROM releases ORDER BY id")
      .all() as { id: string; finalized_at: string | null; push_to_github: number; finalize_errors: string | null }[];
    expect(rows[0]).toMatchObject({ id: "old", finalized_at: "2026-08-01T10:00:00.000Z", push_to_github: 0, finalize_errors: null });
    // Without a creation stamp it is still finalised — never reconciled again.
    expect(rows[1].finalized_at).not.toBeNull();
    conn.close();
  });
});
