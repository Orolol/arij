/**
 * The INVARIANTS OF THE MIGRATION JOURNAL, asserted once.
 *
 * Every one of these was, until now, re-tested inside each migration's own
 * test file, under the same title: "is a hand-written journal migration with a
 * unique increasing timestamp", "leaves the drizzle-kit snapshots untouched",
 * "every journal tag has its file". They are global facts about the journal —
 * `meta/_journal.json` and the `.sql` files beside it — not facts about one
 * migration, so a new migration adds a whole copy of them and a change to the
 * rule has to be made in N places.
 *
 * What each migration test KEEPS is what only it can assert: the DDL it adds,
 * that the columns land, that existing rows survive, that a replay is a no-op.
 * What it does not need to re-assert is anything below.
 *
 * The rules, and why each is worth pinning:
 *
 *  1. `when` STRICTLY INCREASES along the journal. Drizzle applies a migration
 *     only when its `when` exceeds the last one recorded in the database, so an
 *     equal or lower value is silently skipped — the migration exists, is
 *     listed, and never runs. This is the regression the per-migration copies
 *     were written for (0048/0049 took slots while another branch was in
 *     review), and it is caught here once, for every entry.
 *  2. `idx` IS the array position. Nothing reads it (drizzle queries by
 *     `when`), so a wrong one is invisible — which is exactly why it should be
 *     derived rather than trusted.
 *  3. No two entries share a tag or a `when`.
 *  4. Every tag has its `.sql` on disk. `readMigrationFiles` throws on a
 *     missing file, but only when the migrator runs; a test catches it at
 *     review time.
 *  5. The drizzle-kit SNAPSHOTS stop at 0013. They are stale relative to the
 *     journal, and `npx drizzle-kit generate` would diff against them and emit
 *     wrong DDL — CLAUDE.md forbids running it, and this is the mechanical
 *     reason why.
 *  6. Every `POST_BASELINE_COLUMN_MIGRATIONS` entry names a journal `when`.
 *     That table raises the stamp ceiling for a legacy database, so an entry
 *     pointing at a `when` no migration has would push the ceiling past real
 *     migrations and skip them.
 *
 * The per-migration files keep the opposite assertion where it applies: an
 * INDEX-only migration must NOT be in that table (see
 * `agent-sessions-epic-cost-index-migration.test.ts`).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "./helpers/migration";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function readJournal(): { entries: JournalEntry[] } {
  const raw = fs.readFileSync(
    path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"),
    "utf-8",
  );
  return JSON.parse(raw) as { entries: JournalEntry[] };
}

const journal = readJournal();

/** The table `POST_BASELINE_COLUMN_MIGRATIONS` lives in, read as source. */
function baselineColumnMigrationMillis(): number[] {
  const source = fs.readFileSync(
    path.join(process.cwd(), "lib", "db", "init.ts"),
    "utf-8",
  );
  return [...source.matchAll(/folderMillis:\s*(\d+)/g)].map((match) =>
    Number(match[1]),
  );
}

describe("migration journal invariants", () => {
  it("has a strictly increasing `when` along the journal", () => {
    const offenders: string[] = [];
    for (let i = 1; i < journal.entries.length; i += 1) {
      const previous = journal.entries[i - 1];
      const current = journal.entries[i];
      if (current.when <= previous.when) {
        offenders.push(
          `${current.tag} (when ${current.when}) does not exceed ` +
            `${previous.tag} (when ${previous.when})`,
        );
      }
    }

    expect(
      offenders,
      "Drizzle applies a migration only when its `when` exceeds the last one " +
        "recorded in the database, so an equal or lower value is SKIPPED " +
        "silently: the migration exists, is listed, and never runs.",
    ).toEqual([]);
  });

  it("derives `idx` from the array position", () => {
    const offenders = journal.entries
      .map((entry, position) => ({ entry, position }))
      .filter(({ entry, position }) => entry.idx !== position)
      .map(({ entry, position }) => `${entry.tag}: idx ${entry.idx}, position ${position}`);

    expect(offenders).toEqual([]);
  });

  it("has no duplicate tag and no duplicate `when`", () => {
    const tags = journal.entries.map((entry) => entry.tag);
    const whens = journal.entries.map((entry) => entry.when);
    expect(new Set(tags).size).toBe(tags.length);
    expect(new Set(whens).size).toBe(whens.length);
  });

  it("has the .sql file of every journal entry on disk", () => {
    const missing = journal.entries
      .filter(
        (entry) => !fs.existsSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)),
      )
      .map((entry) => entry.tag);

    expect(missing, "readMigrationFiles throws on a missing file").toEqual([]);
  });

  it("keeps the drizzle-kit snapshots at 0013 — `generate` must never be run", () => {
    const snapshots = fs
      .readdirSync(path.join(MIGRATIONS_FOLDER, "meta"))
      .filter((name) => name.endsWith("_snapshot.json"))
      .sort();

    // They are stale relative to the journal, so `drizzle-kit generate` would
    // diff against them and emit wrong DDL. CLAUDE.md forbids running it; this
    // is the mechanical half of that rule.
    expect(snapshots[snapshots.length - 1]).toBe("0013_snapshot.json");
  });

  it("names a real journal `when` from every POST_BASELINE_COLUMN_MIGRATIONS entry", () => {
    const known = new Set(journal.entries.map((entry) => entry.when));
    const unknown = baselineColumnMigrationMillis().filter(
      (millis) => !known.has(millis),
    );

    expect(
      unknown,
      "A baseline entry whose `when` no migration carries would raise the " +
        "stamp ceiling past real migrations and skip them on a legacy database.",
    ).toEqual([]);
  });
});
