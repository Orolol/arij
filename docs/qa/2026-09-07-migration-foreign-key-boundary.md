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
(so a throwing migration cannot leave the connection unenforced), and
requires `PRAGMA foreign_key_check` to come back empty on every startup,
throwing and refusing startup otherwise.

The check runs unconditionally on every startup so that validation failures
persist across server restarts: because drizzle commits the migration before
post-migration validation runs, skipping the check when 0 migrations are
pending would fail open on restart. Checking foreign keys on a healthy dev
database takes ~93 ms and guarantees referential consistency.

The suspension is read back rather than assumed. The defect's own mechanism
applies one level up: an `initDb()` called from inside an open transaction
would have its pragma ignored the same silent way, so that case throws instead
of migrating with cascades armed.

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

`__tests__/db-init-foreign-keys.test.ts` (8 tests) drives the real `initDb()`
entry point:

- a rebuild of `agent_sessions` staged onto the real migration chain preserves
  the CASCADE children and the SET NULL links (red before the fix: chunks,
  sequences and artifacts all dropped to 0, both link counts to 0);
- the same rebuild with a NO ACTION `ticket_comments` link does not abort (red
  before the fix: `FOREIGN KEY constraint failed`);
- foreign keys stay enforced after a successful run (an orphan insert still
  throws);
- the pragma is restored when a migration throws;
- `initDb()` called inside an open transaction refuses to migrate rather than
  proceeding with cascades armed, and leaves every child row untouched (red
  before the fix: the migration went ahead and failed on `BEGIN`);
- a migration that leaves a dangling reference behind refuses startup (red
  before the fix: the offending insert simply failed under enforcement, so the
  `foreign_key_check` gate was never reached);
- startup refusal persists across reopen when a migration left foreign-key
  violations behind (red before the fix: drizzle commits the migration before
  validation throws, so a check skipped on 0 pending migrations failed open on
  the second startup);
- a self-contained parent/child fixture covering CASCADE, SET NULL and NO
  ACTION explicitly.

Red state proven by hand, not only by construction: with the merge-base
`lib/db/init.ts` (`git show HEAD~1:lib/db/init.ts`) restored over the fix, 6 of
the 8 tests fail with exactly the symptoms above; restoring the fix returns all
8 to green. The two that pass on both sides are the guards that the fix must
not *weaken* — foreign keys still enforced after a successful run, and the
pragma restored on a throwing migration.

## Suite state

Full Vitest suite on the branch: **647 files, 8784 tests, all passed, exit code
0**, 164.8 s, taken under contention (load average ~10–12; a second session was
running its own full suite concurrently). `tsc --noEmit` clean with every dev
server stopped; eslint clean on the changed files.

## Prose corrected

`0003`, `0012`, `0029`, `0051` and `0054` each carried, or implied through the
"following 0003, 0012 and 0029" guidance, that the in-file pragma works. Each
now states that it is a no-op and points at the connection-level boundary.

## Scope note

This prevents future rebuild loss. It reconstructs nothing: no data has been
lost so far only because `0003`/`0012` are baseline-stamped on existing
databases and `0029`/`0051` rebuild tables nothing references.
