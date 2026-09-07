# Registry cost sort — covering index investigation

**Ticket:** yV9lwU2012_b — *Optimiser le tri par coût des fenêtres terminales du registre*
**Follow-up of:** review of `pcXbuN4vrAQ0`, finding `b2MVPwQm86OC`
**Measured against:** `main` at `a565bd2f`, after `npm ci` in a worktree that had **no `node_modules` at all**
**Machine:** shared; load average recorded per run below (1.0–5.6 across the session)
**Outcome:** index adopted — migration `0056_agent_sessions_epic_cost_idx`

---

## 1. Question

`app/api/tickets/route.ts`, `terminalSortValue.cout`, orders each terminal
window by a correlated `SUM(total_cost_usd)` per done/released candidate,
evaluated **before** the `LIMIT 40`. The prior review reported 50 ms against
11 ms for the date sort at 2000 epics / 6000 sessions, but those figures were
never reproduced. The pickup contract asked whether the cost is real, and
whether a covering `(epic_id, total_cost_usd)` index is worth a migration.

**Inherited figures are not evidence and are not reused below.** Everything
here was measured in this session.

## 2. Size of the real registry

Read-only against the live development database (`data/arij.db`, 1.17 GB):

| | |
|---|---|
| epics, terminal (`done` + `released`) | **245** (244 + 1) |
| epics, total | 301 |
| `agent_sessions` | 1457 |
| sessions attached to a terminal epic | 884 |
| sessions carrying a cost | 1050 |
| projects | 2 |
| **mean `agent_sessions.prompt` length** | **78 243 bytes** (max 4 963 024) |

The registry is roughly an eighth of the 2000-epic fixture. On that fact alone
the expected answer was "measure, find it is fine, close". It is not fine, and
the reason is the last row of that table rather than any of the others.

## 3. Method

- Working copy of the real database taken with `better-sqlite3`'s `.backup()`,
  so the snapshot is consistent with the live WAL. All timing runs use copies;
  the live database was only ever opened read-only.
- The measured statement is built **through drizzle from `lib/db/schema`**,
  reproducing `terminalWindow()` call-for-call, rather than retyped by hand.
  One measured "request" is the done window plus the released window, as the
  route issues them.
- **Interleaved A/B in blocks of 10**, dropping and recreating the index
  between blocks, so a load spike cannot land entirely on one arm. Raw
  per-request times, never pre-aggregated. 5 warm-up requests per sort first.
- Result sets fingerprinted by row id and compared between arms.

## 4. Result — real data, 245 terminal epics

Median ms per request, `n = 60` per arm, two independent runs:

| Sort | Baseline (`agent_sessions_epic_idx`) | With covering index |
|---|---|---|
| `cout`, run 1 (load 1.20) | **10.35** (p95 11.59) | **0.78** (p95 1.12) |
| `cout`, run 2 (load 2.32) | **12.06** (p95 13.81) | **0.86** (p95 1.38) |
| `activite`, run 1 | 0.61 | 0.61 |
| `activite`, run 2 | 0.66 | 0.68 |

The arms' full ranges do not overlap in either run (baseline min 9.49,
indexed max 1.35). Run 2 ran under higher load and both arms rose together,
which is what an interleaved design should show. The date sort is unchanged,
confirming the effect is the aggregate and not ambient noise.

Query plan, unchanged structure apart from the index:

```
baseline: SEARCH agent_sessions USING INDEX agent_sessions_epic_idx (epic_id=?)
indexed:  SEARCH agent_sessions USING COVERING INDEX agent_sessions_epic_cost_idx (epic_id=?)
```

The correlated subquery appears **twice** in every plan — once for the
`IS NULL` bucket, once for the value. SQLite does not factor it. Both
evaluations become index-only.

## 5. Why the inherited fixture understated it

The synthetic 2000/6000 fixture was rebuilt deterministically (seeded
mulberry32, schema copied verbatim from the real database so the indexes
match) in two variants differing **only** in row width:

| Fixture, 2000 epics / 6000 sessions | Baseline | Covering | Ratio |
|---|---|---|---|
| narrow rows (placeholder prompts) | 3.76 ms | 2.07 ms | 1.8× |
| realistic rows (78 KB mean prompt) | **86.18 ms** | **2.10 ms** | **41×** |

The covering arm is the same in both (2.07 / 2.10 ms) — index-only reads never
touch the table, so row width stops mattering. The baseline arm moves by 23×
on row width alone.

**This is the finding.** The cost of the sort tracks how wide `agent_sessions`
rows are, not how many sessions there are, because each non-covering probe
leaves the index to walk overflow pages for one `REAL` column. A synthetic
fixture with narrow rows measures the wrong variable, which is why it reports
a small constant factor where real data shows an order of magnitude. The index
does not just lower the constant; it makes the sort **independent of row
width**, which is the property worth buying.

## 6. Cost of the index

Write path, 400 inserts of a real median-width (~78 KB) session row plus 400
`total_cost_usd` updates, on copies of the real database (load 5.56 — the
noisiest run of the session):

| Configuration | Insert median | Insert p95 | Cost-update median | Total index bytes |
|---|---|---|---|---|
| A. `epic_idx` only (before) | 0.1777 | 2.293 | 0.0534 | 311 296 |
| B. both indexes (**adopted**) | 0.1849 | 2.332 | 0.0578 | 364 544 |
| C. covering replaces `epic_idx` | 0.1842 | 1.439 | 0.0600 | 315 392 |

Writes are dominated by the 78 KB row itself; the extra index is not
measurable against run-to-run noise. Storage cost is **53 KB on a 1.17 GB
database** (0.005%).

Migration applied to a copy of the real database: `initDb()` completes in
**103 ms** total, `PRAGMA quick_check` returns `ok`, and a second `initDb()`
leaves exactly one index (replay-safe, `CREATE INDEX IF NOT EXISTS`). The
index is not `UNIQUE`, so the pre-existing-duplicate hazard does not apply.

### Legacy databases

`0056` gets **no** `POST_BASELINE_COLUMN_MIGRATIONS` entry, matching `0043`
and `0046`. That list is for column-adding migrations only; an entry raises
the baseline stamp ceiling, so adding one would mark this migration applied
without running it and a bookkeeping-less database would silently never get
the index. The test suite pins that path: ledger dropped, index dropped,
`initDb()` re-run, index back and planning as `COVERING`.

Two pre-existing fixtures in `__tests__/db-init.test.ts` needed a line each:
they rewind to a legacy schema by dropping `total_cost_usd`, and SQLite
refuses to drop a column an index still references. They already did this for
`agent_sessions_named_agent_activity_idx`; the new index needs the same
`DROP INDEX` before the rewind, and the replay re-creates it.

One state was reached while writing those tests and is worth recording as
**not** a defect: if `total_cost_usd` is absent while a *later* stamped column
(`projects.clone_source`, 0028) is present, the ceiling lands above 0024, the
column is never re-added, and `0056` then fails to create its index. Real
databases acquire those columns in migration order, so the combination is
unreachable — but it is the shape a hand-built fixture falls into.

## 7. Why `agent_sessions_epic_idx` was kept

`epic_id` is a strict prefix of `(epic_id, total_cost_usd)`, so the new index
serves every query the old one serves — a property of B-tree prefixes, not a
per-call-site measurement. Every `epic_id` consumer was checked anyway:

| Query shape (call sites) | A: `epic_idx` only | C: covering only |
|---|---|---|
| single epic lookup (`workflow/context`, `verify/freshness`) | SEARCH, 0.0067 ms | SEARCH, 0.0053 ms |
| delete scope (`planning/permanent-delete`) | SEARCH, 0.0035 ms | SEARCH, 0.0042 ms |
| `IN (...)` scope (`pipeline/findings`, `review-freshness`) | SEARCH, 0.0043 ms | SEARCH, 0.0058 ms |
| window partition (`review-freshness.epicSessionRows`) | SEARCH, 26.30 ms | SEARCH, 26.49 ms |
| cost aggregate (this ticket) | SEARCH, 0.0038 ms | **COVERING**, 0.0025 ms |
| cost rollup (route step 6) | SEARCH, 0.0049 ms | **COVERING**, 0.0036 ms |

Nothing regresses under C. It was still **not** adopted: it measured no write
saving (insert median 0.1842 vs 0.1849 ms, inside noise) and would have cost
migration 0046 its `agent_sessions_epic_idx` guard and its plan assertion.
Paying a deliberate guard for an unmeasurable gain is a bad trade. The
redundancy is recorded in `0056`'s header and in `schema.ts`; dropping the
narrow index is a separable cleanup, not part of this fix.

## 8. What was preserved

- **Global selection before `LIMIT`** — untouched. The ordering expression,
  the `IS NULL` bucket, the `DESC`/`ASC` direction and the `epics.id`
  tie-break are byte-identical; only the access path changed.
- **Correctness** — result sets fingerprinted by row id are identical between
  arms for both `cout` and `activite`, on the real data and on both fixtures.
  A unit test additionally pins that epics with a NULL aggregate (no session
  at all, and a session with a NULL cost) stay in the trailing bucket ordered
  by id, with and without the index.
- **Pagination** — `doneLimit` / `releasedLimit` and their clamping are not
  touched. An index cannot change which rows a query returns.

## 9. Not done, deliberately

- **Durable aggregate column.** Not adopted and not needed: the index closes
  the gap to the date sort (0.78 ms against 0.61 ms) without introducing a
  stored value that can drift from its source. It would need its own
  justification, and after this change there is no performance argument left
  for it.
- **The doubled subquery.** The `IS NULL` bucket makes SQLite evaluate the
  aggregate twice per candidate. `NULLS LAST` (SQLite ≥ 3.30; 3.51.2 here)
  would collapse it to one, but it changes the ORDER BY for *every* sort, and
  the remaining headroom after the index is ~0.15 ms. Not worth the null- and
  tie-break risk in this diff. **Filed as a separate item, not fixed here.**
- **`stories` sort.** Shares the double-evaluation shape, but its aggregate is
  *already* index-only: `count(*)` over
  `user_stories_epic_position_idx (epic_id, position)` plans as
  `SEARCH user_stories USING COVERING INDEX`. Checked rather than assumed —
  it needs no index of its own.
- **The 26 ms window-partition row in §7.** That shape
  (`epic_id IS NOT NULL`, no project, no `epicIds`) is the *unscoped* worst
  case `epicSessionFactsCte`'s own header already warns against and requires
  callers to avoid. It was included only to confirm this index does not make
  it worse — it does not (26.30 / 26.49 / 26.58 ms across all three
  configurations). Whether any caller actually reaches it unscoped was **not**
  investigated and is not claimed either way here.
- **End-to-end `/api/tickets` latency.** Measured at the query layer only, on
  the two windows the ticket names. Not measured through a running server —
  `next dev` Strict Mode double-invokes and cold compiles would measure the
  framework, not the query.

## 10. Reproducing

Scratch harnesses were deleted with the working databases; the measured
statement is reproducible from `terminalWindow()` in `app/api/tickets/route.ts`
plus `EXPLAIN QUERY PLAN`. The permanent guard is
`__tests__/agent-sessions-epic-cost-index-migration.test.ts`, which asserts
the plan says `COVERING INDEX` rather than merely that the index exists —
the index existing proves nothing if the planner still reads the table.
