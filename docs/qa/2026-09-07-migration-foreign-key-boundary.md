# B-arij-251 — `PRAGMA foreign_keys=OFF` inside rebuild migrations is a no-op

Verification report for the migration foreign-key boundary fix.
Measured 2026-09-07 on branch
`feature/epic-xqePlawrnh97-pragma-foreign-keys-off-inside-rebuild-m`,
merge-base `main` @ 2172f47e, against a clean `npm ci` install
(1024 packages, lockfile-consistent).

## The defect

Migrations `0003`, `0012`, `0029` and `0051` rebuild a table with the drizzle
pattern `PRAGMA foreign_keys=OFF; CREATE __new…; INSERT … SELECT; DROP TABLE …;
ALTER TABLE … RENAME; PRAGMA foreign_keys=ON`.

Drizzle's sqlite migrator (`SQLiteSyncDialect.migrate`, drizzle-orm 0.44.x)
runs `BEGIN` before the whole batch and `COMMIT` after it. SQLite ignores
`PRAGMA foreign_keys` while a transaction is open, so the pragma written into a
migration file never takes effect. `lib/db/index.ts` sets `foreign_keys = ON`
on the production connection, so every such `DROP TABLE` ran with foreign keys
enforced.

## The fix

`initDb()` now calls `migrateWithForeignKeysSuspended()`
(`lib/db/init.ts`): it suspends `foreign_keys` on the **connection**, outside
drizzle's transaction, restores the caller's previous setting in a `finally`
(so a throwing migration cannot leave the connection unenforced), and — when
the run actually applied at least one migration — requires
`PRAGMA foreign_key_check` to come back empty, throwing and refusing startup
otherwise.

The check is deliberately skipped when nothing was applied: a database that was
already inconsistent for unrelated reasons must not be bricked by a routine
startup that ran no DDL.

## Measurements against a copy of the real dev database

Snapshot taken read-only with better-sqlite3's `backup()` from
`~/workspace/arij/data/arij.db` (1.1 GB, 55/55 migrations applied, live dev
server writing to it). A synthetic rebuild of `agent_sessions` — the exact
migration the ticket names as the next likely one — was appended to a copy of
the real migrations folder and applied three ways.

Baseline population: 1467 `agent_sessions`, 264 784 `agent_session_chunks`,
1319 `agent_session_sequences`, 40 `session_artifacts`, 8 linked `qa_reports`,
196 linked `notifications`, 1704 linked `ticket_comments`.

### A. Old boundary — `migrate()` with `foreign_keys = ON`

The rebuild **aborts**: `SqliteError: FOREIGN KEY constraint failed`, raised by
the implicit `DELETE FROM agent_sessions` that `DROP TABLE` performs, blocked
by `ticket_comments.agent_session_id` (NO ACTION, 1704 rows). The migrator
rolls back, so no rows are lost — but the migration can never be applied and
startup fails.

### B. Old boundary with the NO ACTION links cleared first

With `ticket_comments.agent_session_id` nulled, nothing blocks the delete and
the loss is **silent**:

| Table / link | Before | After |
|---|---|---|
| `agent_session_chunks` (CASCADE) | 264 784 | **0** |
| `agent_session_sequences` (CASCADE) | 1 319 | **0** |
| `session_artifacts` (CASCADE) | 40 | **0** |
| `qa_reports.agent_session_id` (SET NULL) | 8 | **0** |
| `notifications.session_id` (SET NULL) | 196 | **0** |
| `agent_sessions` | 1 467 | 1 467 |

The migration reports success.

### C. New boundary — `initDb()`

`initDb` applied the same rebuild in 434 ms with **zero drift**: every count
and every link above is identical before and after. `foreign_keys` is back to
`1` afterwards and `PRAGMA foreign_key_check` returns no rows.

A separate run of `initDb()` against an untouched dev-DB copy (nothing pending,
55 → 55 migrations recorded) also showed zero drift, foreign keys still on, and
no violations — the fix is inert on the ordinary startup path.

## Automated coverage

`__tests__/db-init-foreign-keys.test.ts` (6 tests) drives the real `initDb()`
entry point:

- a rebuild of `agent_sessions` staged onto the real migration chain preserves
  the CASCADE children and the SET NULL links (red before the fix: chunks,
  sequences and artifacts all dropped to 0, both link counts to 0);
- the same rebuild with a NO ACTION `ticket_comments` link does not abort (red
  before the fix: `FOREIGN KEY constraint failed`);
- foreign keys stay enforced after a successful run (an orphan insert still
  throws);
- the pragma is restored when a migration throws;
- a migration that leaves a dangling reference behind refuses startup (red
  before the fix: the offending insert simply failed under enforcement, so the
  `foreign_key_check` gate was never reached);
- a self-contained parent/child fixture covering CASCADE, SET NULL and NO
  ACTION explicitly.

## Prose corrected

`0003`, `0012`, `0029`, `0051` and `0054` each carried, or implied through the
"following 0003, 0012 and 0029" guidance, that the in-file pragma works. Each
now states that it is a no-op and points at the connection-level boundary.

## Scope note

This prevents future rebuild loss. It reconstructs nothing: no data has been
lost so far only because `0003`/`0012` are baseline-stamped on existing
databases and `0029`/`0051` rebuild tables nothing references.
