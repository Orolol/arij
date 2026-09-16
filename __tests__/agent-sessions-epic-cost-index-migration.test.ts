/**
 * Migration coverage for the registry's cost-sort covering index (0056).
 *
 * `/api/tickets` sorts its two terminal windows by a correlated
 * `SUM(total_cost_usd)` evaluated per done/released candidate BEFORE the
 * LIMIT (app/api/tickets/route.ts, `terminalSortValue.cout`). Served by
 * `agent_sessions_epic_idx`, that aggregate is a SEARCH on `(epic_id)`
 * followed by a table lookup per matching session — and `agent_sessions`
 * rows are wide (a ~78 KB average `prompt` on a real board), so each lookup
 * walks overflow pages to read one REAL column.
 *
 * `(epic_id, total_cost_usd)` makes the aggregate index-only. The assertions
 * that matter here are the plan ones: the index existing proves nothing if
 * the planner still leaves it to read the table.
 */
import fs from "fs";
import Database from "better-sqlite3";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { initDb } from "@/lib/db/init";
import { indexColumns, indexList, tempDbPath, withDb } from "./helpers/migration";

const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib", "db", "migrations");
const MIGRATION_TAG = "0056_agent_sessions_epic_cost_idx";
const INDEX_NAME = "agent_sessions_epic_cost_idx";
const INDEX_COLUMNS = ["epic_id", "total_cost_usd"];

const journal = JSON.parse(
  fs.readFileSync(
    path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"),
    "utf-8"
  )
) as { entries: { idx: number; when: number; tag: string }[] };

/**
 * The ORDER BY term `terminalSortValue.cout` builds, verbatim. Drizzle emits
 * it twice per query — once for the `IS NULL` bucket, once for the value —
 * so this one subquery is the whole cost of the sort.
 */
const COST_AGGREGATE =
  "SELECT sum(total_cost_usd) FROM agent_sessions WHERE agent_sessions.epic_id = 'e'";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function queryPlan(conn: Database.Database, sql: string): string {
  return (
    conn.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]
  )
    .map((row) => row.detail)
    .join(" | ");
}

describe("0056_agent_sessions_epic_cost_idx", () => {
  it("is hand-written, with a journal entry whose idx and `when` only increase", () => {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_FOLDER, `${MIGRATION_TAG}.sql`),
      "utf-8"
    );

    // IF NOT EXISTS is what keeps the migration replay-safe and out of the
    // baseline-stamping list in lib/db/init.ts.
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    expect(sql).toContain(`\`${INDEX_NAME}\``);

    const position = journal.entries.findIndex(
      (candidate) => candidate.tag === MIGRATION_TAG
    );
    expect(position, `${MIGRATION_TAG} missing from meta/_journal.json`)
      .toBeGreaterThanOrEqual(0);

    // Drizzle only applies a migration whose `when` exceeds the last one
    // recorded, so journal order and timestamps must both increase.
    //
    // Deliberately NOT asserting that this entry is the journal's last: a
    // later migration appending 0057 is normal, and a guard that reddens for
    // it would be a landmine rather than a check.
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index)
    );
    const whens = journal.entries.map((entry) => entry.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(journal.entries[position].when).toBeGreaterThan(
      journal.entries[position - 1].when
    );
  });

  it("creates the index, with the declared column order, on a fresh database", () => {
    withDb(tempDbPath(), (conn) => {
      initDb(conn);

      expect(
        indexList(conn, "agent_sessions"),
        `${INDEX_NAME} missing from PRAGMA index_list(agent_sessions)`
      ).toContain(INDEX_NAME);
      expect(indexColumns(conn, INDEX_NAME)).toEqual(INDEX_COLUMNS);
    });
  });

  it("makes the registry's cost aggregate index-only", () => {
    withDb(tempDbPath(), (conn) => {
      initDb(conn);

      // The defect, precisely: on `agent_sessions_epic_idx` this plans as a
      // bare SEARCH and reads the table for every matching session. "COVERING"
      // is the word that says it never leaves the index.
      expect(queryPlan(conn, COST_AGGREGATE)).toContain(
        `SEARCH agent_sessions USING COVERING INDEX ${INDEX_NAME} (epic_id=?)`
      );
    });
  });

  it("makes the per-row cost rollup index-only too", () => {
    withDb(tempDbPath(), (conn) => {
      initDb(conn);

      // app/api/tickets/route.ts step 6 groups the same column for the rows it
      // returns; it reads the same index and must not fall back to the table.
      expect(
        queryPlan(
          conn,
          `SELECT epic_id, SUM(total_cost_usd) FROM agent_sessions
             WHERE epic_id IN ('a', 'b') GROUP BY epic_id`
        )
      ).toContain(`COVERING INDEX ${INDEX_NAME}`);
    });
  });

  it("leaves plain epic_id lookups index-driven", () => {
    withDb(tempDbPath(), (conn) => {
      initDb(conn);

      // A second index on the same leading column must not push any existing
      // epic-scoped lookup back to a SCAN. Either index is a correct answer:
      // `epic_id` is a strict prefix of both.
      const plan = queryPlan(
        conn,
        "SELECT id FROM agent_sessions WHERE epic_id = 'e'"
      );
      expect(plan).toMatch(
        /SEARCH agent_sessions USING (COVERING )?INDEX agent_sessions_epic(_cost)?_idx \(epic_id=\?\)/
      );
    });
  });

  it("replays as a no-op on a database that already carries the index", () => {
    const file = tempDbPath();

    withDb(file, (conn) => {
      initDb(conn);

      // Re-running the whole migration path must not duplicate the index.
      conn.exec(
        "CREATE INDEX IF NOT EXISTS `agent_sessions_epic_cost_idx` ON `agent_sessions` (`epic_id`, `total_cost_usd`)"
      );
      expect(() => initDb(conn)).not.toThrow();

      expect(
        indexList(conn, "agent_sessions").filter((name) => name === INDEX_NAME)
      ).toEqual([INDEX_NAME]);
    });
  });

  it("reaches a legacy database that has no migration bookkeeping", () => {
    withDb(tempDbPath(), (conn) => {
      initDb(conn);

      // The legacy shape that actually occurs: every column present, but no
      // ledger, so initDb baseline-stamps and then advances. Stamping raises
      // the ceiling to the newest column it finds — which is exactly why an
      // index-only migration must NOT get a POST_BASELINE_COLUMN_MIGRATIONS
      // entry (lib/db/init.ts says so): an entry would push the ceiling over
      // this DDL and a legacy database would silently never get the index.
      conn.exec('DROP TABLE "__drizzle_migrations"');
      conn.exec(`DROP INDEX ${INDEX_NAME}`);
      conn.exec("ALTER TABLE review_comments DROP COLUMN dismissed_reason");
      // Restore the pre-0058 shape as well, so its column removal does not stamp away 0056.
      conn.exec("ALTER TABLE named_agents ADD COLUMN readable_agent_name TEXT");
      // …as of before the ledger: a bookkeeping-less database cannot carry a
      // column that only ever arrived through a ledgered migration, and
      // 0062's columns would raise the stamp ceiling over this index.
      for (const column of [
        "published_at",
        "changelog_session_id",
        "push_to_github",
        "finalized_at",
        "finalize_errors",
      ]) {
        conn.exec(`ALTER TABLE releases DROP COLUMN ${column}`);
      }

      initDb(conn);

      expect(indexList(conn, "agent_sessions")).toContain(INDEX_NAME);
      expect(indexColumns(conn, INDEX_NAME)).toEqual(INDEX_COLUMNS);
      // And it is genuinely usable, not merely present.
      expect(queryPlan(conn, COST_AGGREGATE)).toContain(
        `COVERING INDEX ${INDEX_NAME}`
      );
    });
  });

  it("does not change which rows the cost sort returns, or their order", () => {
    withDb(tempDbPath(), (conn) => {
      initDb(conn);

      conn.exec(`
        INSERT INTO projects (id, name) VALUES ('p1', 'P');
        INSERT INTO epics (id, project_id, title, status, position)
        VALUES ('e1','p1','A','done',0), ('e2','p1','B','done',1),
               ('e3','p1','C','done',2), ('e4','p1','D','done',3);
        INSERT INTO agent_sessions (id, project_id, epic_id, total_cost_usd) VALUES
          ('s1','p1','e1', 1.5), ('s2','p1','e1', 2.0),
          ('s3','p1','e2', 9.0),
          ('s4','p1','e3', NULL);
      `);

      // e4 has no session at all, e3 only a NULL cost: both aggregate to NULL
      // and must land in the trailing bucket, ordered by id — the `IS NULL`
      // term the route puts first. An index may not touch that.
      const order = `
        SELECT id FROM epics WHERE status = 'done'
        ORDER BY (SELECT sum(total_cost_usd) FROM agent_sessions
                    WHERE agent_sessions.epic_id = epics.id) IS NULL,
                 (SELECT sum(total_cost_usd) FROM agent_sessions
                    WHERE agent_sessions.epic_id = epics.id) DESC,
                 id ASC
      `;
      const withIndex = (conn.prepare(order).all() as { id: string }[]).map(
        (row) => row.id
      );
      expect(withIndex).toEqual(["e2", "e1", "e3", "e4"]);

      conn.exec(`DROP INDEX ${INDEX_NAME}`);
      conn.exec("ALTER TABLE review_comments DROP COLUMN dismissed_reason");
      // Restore the pre-0058 shape as well, so its column removal does not stamp away 0056.
      conn.exec("ALTER TABLE named_agents ADD COLUMN readable_agent_name TEXT");
      const withoutIndex = (conn.prepare(order).all() as { id: string }[]).map(
        (row) => row.id
      );
      expect(withoutIndex).toEqual(withIndex);
    });
  });
});
