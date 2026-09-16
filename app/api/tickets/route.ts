import { readActiveSessionRows, readMergeFacts } from "@/lib/control-desk/read-model";
import { catalogueValue } from "@/lib/i18n/catalogue";
import { COLUMN_LABEL_KEYS } from "@/lib/types/kanban";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionLastActivityAt } from "@/lib/agents/watchdog";
import { deriveProjects } from "@/lib/control-desk/aggregate";
import { lookbackCutoff, readEpicActivityFacts, readLatestFailureSessions, storedTimestampSince } from "@/lib/control-desk/read-model";
import {
  CONTROL_DESK_LOOKBACK_DAYS
} from "@/lib/control-desk/types";
import { db } from "@/lib/db";
import {
  agentSessions,
  epics,
  projects,
  releases,
  ticketDependencies,
  ticketReadCursors
} from "@/lib/db/schema";
import { resolveUiLocaleForRequest } from "@/lib/i18n/resolve-request-locale";
import { translatorFor } from "@/lib/i18n/translator";
import { BUILDABLE_EPIC_STATUSES } from "@/lib/kanban/build-work";
import {
  deriveRegistryRows,
  deriveRegistryTotals,
  type ActivityCopy,
  type RegistryEpicRow,
  type RegistrySessionRow,
} from "@/lib/tickets-registry/aggregate";
import { REGISTRY_SORTS, type RegistrySort } from "@/lib/tickets-registry/sort";
import {
  REGISTRY_COST_WINDOW_DAYS,
  REGISTRY_DONE_WINDOW,
  REGISTRY_QUERY_MAX,
  REGISTRY_RELEASED_WINDOW,
  REGISTRY_WINDOW_MAX,
  type TicketsRegistryPayload,
} from "@/lib/tickets-registry/types";
import type { TicketDependencyEdge } from "@/lib/types/kanban";
import { KANBAN_COLUMNS, type KanbanStatus } from "@/lib/types/kanban";
import { epicSessionFactsCte } from "@/lib/workflow/review-freshness";

/**
 * GET /api/tickets — the exhaustive ticket registry (frame 12a).
 *
 * ONE ROUTE, ONE READ, for the same reason the desk aggregates in one place
 * (`app/api/control-desk/route.ts`): better-sqlite3 is synchronous on ONE
 * shared connection, so fanning out to per-project routes would run N
 * sequential queries per poll and block the event loop for the whole app —
 * SSE heartbeats included.
 *
 * WHY A WINDOW AND NOT A CURSOR. `backlog / todo / in_progress / review /
 * to_merge` is the OPEN WORKING SET: bounded by how much work exists, and the
 * desk already loads all of it every 4 s. `done` and `released` grow forever.
 * So this route loads the open set WHOLE — the registry is exhaustive about
 * what is live — and the two terminal statuses through an ORDERED WINDOW whose
 * size the client raises when the user clicks "tout montrer". The counts are
 * computed SEPARATELY and exactly (step 2), so "+ n autres released" is the
 * true remainder even while the window holds 40 rows.
 *
 * SCAN DISCIPLINE, copied from the desk rather than approximated. Every clause
 * exists for a measured reason spelled out at `app/api/control-desk/
 * route.ts:68-106`:
 *
 * - `agent_sessions` has exactly two secondary indexes, `(project_id,
 *   created_at)` and `(epic_id)`. A bare `created_at >= cutoff` prunes NOTHING
 *   — `created_at` is the second column of a composite whose first column is
 *   unconstrained — so every time-bounded scan here also carries
 *   `project_id IN (...)`, which turns a full scan into one index range per
 *   project. Measured 12.0 ms -> 0.26 ms on the developer's board. The clause
 *   removes no row: `agent_sessions.project_id` is NOT NULL with a cascading FK.
 *
 * - the per-epic fact queries scan by `epic_id IN (<the epics this response
 *   renders>)`. That is TIGHTER than a time cutoff and also EXACT: the outer
 *   join keeps only these ids anyway, whereas a cutoff would silently change
 *   answers (a `changes_requested` verdict older than it would vanish and the
 *   ticket would read as ready to merge).
 *
 * - the running/queued read is the one deliberately unindexed scan (`status`
 *   carries no index). Its answer must not be truncated — a session queued
 *   three weeks ago is still queued — and it reads only narrow columns.
 *
 * NEVER SELECT `agent_sessions.prompt`: it averages 77 KB and reaches 5 MB.
 * NEVER SELECT `epics.description`: it is uncapped agent-written markdown of
 * the same hazard class, and the registry renders no description. If a future
 * column of this table wants prose, clip it in SQL with `substr(...)`.
 *
 * DELIBERATELY OMITTED versus the desk: the latest-COMMENT-CONTENT query
 * (`route.ts:321-354`). The desk quotes the agent's question on an ASKS YOU
 * card; the registry never quotes a comment. Dropping it removes a
 * `substr(content, 1, 400)` read over `ticket_comments` — 5.5 MB across 1657
 * rows on the developer's board — from every poll. It is missing on purpose;
 * do not "restore" it.
 */

/** The open working set — loaded whole. */
const OPEN_STATUSES = ["backlog", "todo", "in_progress", "review", "to_merge"] as const;

function clampLimit(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(REGISTRY_WINDOW_MAX, Math.max(1, parsed));
}

/**
 * `%…%` for a LIKE, with the wildcards the user typed neutralised.
 *
 * `\` first — escaping it after `%`/`_` would double the escapes it just
 * introduced. Paired with `ESCAPE '\'` at every call site.
 */
function likePattern(raw: string | null): string | null {
  const trimmed = (raw ?? "").trim().slice(0, REGISTRY_QUERY_MAX);
  if (trimmed.length === 0) return null;
  const escaped = trimmed
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `%${escaped}%`;
}

/** The column list every epic query in here shares. Note the absent `description`. */
function epicColumns() {
  return {
    id: epics.id,
    projectId: epics.projectId,
    title: epics.title,
    readableId: epics.readableId,
    status: epics.status,
    position: epics.position,
    priority: epics.priority,
    type: epics.type,
    branchName: epics.branchName,
    prNumber: epics.prNumber,
    createdAt: epics.createdAt,
    updatedAt: epics.updatedAt,
    releaseId: epics.releaseId,
    lastReadAt: ticketReadCursors.lastReadAt,
  };
}

/** One row of {@link epicColumns}, as the three epic queries return it. */
interface BaseEpicRow {
  id: string;
  projectId: string;
  title: string;
  readableId: string | null;
  status: string | null;
  position: number | null;
  priority: number | null;
  type: string | null;
  branchName: string | null;
  prNumber: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  releaseId: string | null;
  lastReadAt: string | null;
}

function emptyPayload(now: Date): TicketsRegistryPayload {
  return {
    generatedAt: now.toISOString(),
    projects: [],
    rows: [],
    counts: {
      all: 0,
      open: 0,
      active: 0,
      yourTurn: 0,
      done: 0,
      released: 0,
    },
    groupTotals: { active: 0, your_turn: 0, waiting: 0, done: 0, released: 0 },
    groupLoaded: { active: 0, your_turn: 0, waiting: 0, done: 0, released: 0 },
    totals: { tickets: 0, projects: 0, cost30dUsd: null },
  };
}

export async function GET(request: Request) {
  const queryStartedAt = Date.now();
  const now = new Date();
  const url = new URL(request.url);
  const scopedProject = url.searchParams.get("project")?.trim() || null;
  const requestedStatus = url.searchParams.get("status");
  const scopedStatus = KANBAN_COLUMNS.includes(requestedStatus as KanbanStatus) ? requestedStatus as KanbanStatus : null;
  const qLike = likePattern(url.searchParams.get("q"));
  const doneLimit = clampLimit(url.searchParams.get("doneLimit"), REGISTRY_DONE_WINDOW);
  const releasedLimit = clampLimit(
    url.searchParams.get("releasedLimit"),
    REGISTRY_RELEASED_WINDOW,
  );

  /* ---- 1. projects -------------------------------------------------- */

  const projectRows = db
    .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
    .from(projects)
    .all();

  if (projectRows.length === 0) {
    return NextResponse.json({ data: emptyPayload(now) });
  }

  /**
   * Every project id, in creation order — the LEADING KEY every epic and
   * session scan below carries. It filters nothing; it is what lets the
   * planner use `epics(project_id, status, position)` and
   * `agent_sessions(project_id, created_at)`.
   *
   * `deriveProjects` is fed the WHOLE list even under `?project=`: `colorIndex`
   * is a position in creation order, so narrowing the list would repaint every
   * ticket chip on the screen.
   */
  const allProjectIds = projectRows.map((row) => row.id);
  const scopedProjectIds = scopedProject ? [scopedProject] : allProjectIds;
  const deskProjects = deriveProjects(projectRows);

  /* ---- 2. exact status counts --------------------------------------- */

  // One index-covered aggregate on `epics_project_status_position_idx`. This is
  // the ONLY thing that answers "how many released tickets exist" — the
  // windowed row queries below must never be asked that question.
  const statusCountRows = db
    .select({ status: epics.status, n: sql<number>`COUNT(*)`.as("n") })
    .from(epics)
    .where(inArray(epics.projectId, scopedProjectIds))
    .groupBy(epics.status)
    .all();

  const statusCounts = new Map<string, number>(
    statusCountRows.map((row) => [row.status ?? "", Number(row.n ?? 0)]),
  );

  /* ---- 3. the open working set, whole ------------------------------- */

  const openRows = db
    .select(epicColumns())
    .from(epics)
    .innerJoin(projects, eq(epics.projectId, projects.id))
    .leftJoin(ticketReadCursors, eq(epics.id, ticketReadCursors.epicId))
    .where(
      and(
        inArray(epics.projectId, scopedProjectIds),
        inArray(epics.status, [...OPEN_STATUSES]),
      ),
    )
    .orderBy(epics.position)
    .all();

  // Order terminal tickets BEFORE limiting them, so changing a header can
  // reveal an older ticket outside the default recency window. These scalar
  // aggregates use the existing epic_id indexes and never read session prose.
  const requestedSort = url.searchParams.get("sort");
  const sort: RegistrySort = REGISTRY_SORTS.includes(requestedSort as RegistrySort)
    ? requestedSort as RegistrySort : "activite";
  const ascending = url.searchParams.get("direction") === "asc";
  const terminalSortValue = {
    ticket: sql`lower(coalesce(${epics.readableId}, ${epics.id}))`,
    titre: sql`lower(${epics.title})`,
    // Status is constant within each terminal window: state sorting is
    // display-only. Keep the newest window in both directions.
    etat: sql`julianday(${epics.updatedAt})`,
    stories: sql`(SELECT count(*) FROM user_stories WHERE user_stories.epic_id = ${epics.id})`,
    priorite: sql`${epics.priority}`,
    activite: sql`julianday(${epics.updatedAt})`,
    // Runs once per terminal candidate, before the LIMIT — see below. It stays
    // affordable only because `agent_sessions_epic_cost_idx`
    // (epic_id, total_cost_usd) makes it index-only: on the plain (epic_id)
    // index the planner reads each matching session's row, and those rows are
    // wide enough (`prompt` averages ~78 KB) that the sort's cost tracks row
    // width rather than session count. Measured at 2000 terminal epics /
    // 6000 sessions of realistic width: 86 ms non-covering, 2.1 ms covering.
    cout: sql`(SELECT sum(total_cost_usd) FROM agent_sessions WHERE agent_sessions.epic_id = ${epics.id})`,
  }[sort];

  /* ---- 4/5. the two terminal windows -------------------------------- */

  // `(project_id, status)` are the index's two leading columns, so this is one
  // range per project. The caller-chosen sort needs a temporary b-tree over
  // all candidates before LIMIT; cost/story sorts also aggregate per candidate
  // — twice, in fact, since the `IS NULL` bucket re-evaluates the same scalar
  // subquery. Both evaluations are index-only: `stories` on
  // user_stories_epic_position_idx, `cout` on agent_sessions_epic_cost_idx
  // since 0056.
  // Only the returned rows and their downstream fact queries are bounded.
  // The free-text filter is
  // applied HERE and only here, so a search can reach a released ticket that
  // sits outside the default window.
  const terminalWindow = (status: "done" | "released", limit: number) =>
    db
      .select(epicColumns())
      .from(epics)
      .innerJoin(projects, eq(epics.projectId, projects.id))
      .leftJoin(ticketReadCursors, eq(epics.id, ticketReadCursors.epicId))
      .where(
        and(
          inArray(epics.projectId, scopedProjectIds),
          eq(epics.status, status),
          ...(qLike
            ? [
                or(
                  sql`${epics.title} LIKE ${qLike} ESCAPE '\\'`,
                  sql`${epics.readableId} LIKE ${qLike} ESCAPE '\\'`,
                ),
              ]
            : []),
        ),
      )
      .orderBy(sql`${terminalSortValue} IS NULL`, ascending && sort !== "etat" ? asc(terminalSortValue) : desc(terminalSortValue), asc(epics.id))
      .limit(limit)
      .all();

  const doneRows = terminalWindow("done", doneLimit);
  const releasedRows = terminalWindow("released", releasedLimit);

  const baseEpicRows: BaseEpicRow[] = [...openRows, ...doneRows, ...releasedRows];

  /* ---- 6. the id bound every per-epic fact query carries ------------- */

  const epicIds = baseEpicRows.map((row) => row.id);

  const { latestSessionByEpic, latestUserCommentByEpic, storyCountsByEpic, buildQueueByEpic } =
    readEpicActivityFacts(db, epicIds, scopedProjectIds, baseEpicRows.filter((epic) => BUILDABLE_EPIC_STATUSES.has(epic.status ?? "")));
  const costByEpicId = new Map<string, number | null>();
  const freshnessByEpic = new Map<
    string,
    {
      lastCleanReviewAt: string | null;
      lastTerminalCodeAt: string | null;
      lastNegativeVerdictReviewAt: string | null;
      supersessionAt: string | null;
    }
  >();

  if (epicIds.length > 0) {
    /* ---- 10. session facts + the COÛT column ------------------------ */

    // `null` for the project is only safe BECAUSE `scope.epicIds` is supplied:
    // a null project drops the composite index's leading key and the CTE
    // degrades to a full scan of `agent_sessions` on the one synchronous
    // connection (lib/workflow/review-freshness.ts:263-277).
    //
    // One scan answers two questions: the four review-freshness facts the merge
    // gate reads, AND `sessionsCostUsd`. That SUM is the COÛT column, and its
    // NULL is load-bearing — "no session on this ticket reported a cost"
    // renders as an em-dash, never as `$0.00`.
    const facts = epicSessionFactsCte(db, null, { epicIds });
    const factRows = db
      .with(facts)
      .select({
        epicId: facts.epicId,
        sessionsCostUsd: facts.sessionsCostUsd,
        lastCleanReviewAt: facts.lastCleanReviewAt,
        lastTerminalCodeAt: facts.lastTerminalCodeAt,
        lastNegativeVerdictReviewAt: facts.lastNegativeVerdictReviewAt,
        supersessionAt: facts.supersessionAt,
      })
      .from(facts)
      .all();

    for (const row of factRows) {
      if (!row.epicId) continue;
      const cost = row.sessionsCostUsd;
      costByEpicId.set(
        row.epicId,
        typeof cost === "number" && Number.isFinite(cost) ? cost : null,
      );
      freshnessByEpic.set(row.epicId, {
        lastCleanReviewAt: row.lastCleanReviewAt ?? null,
        lastTerminalCodeAt: row.lastTerminalCodeAt ?? null,
        lastNegativeVerdictReviewAt: row.lastNegativeVerdictReviewAt ?? null,
        supersessionAt: row.supersessionAt ?? null,
      });
    }
  }

  /* ---- 11/12. merge blockers, for the `to_merge` slice only ---------- */

  const toMergeIds = baseEpicRows
    .filter((row) => row.status === "to_merge")
    .map((row) => row.id);

  const mergeFacts = readMergeFacts(db, toMergeIds);
  const openFindingsByEpic = new Map([...mergeFacts].map(([id, facts]) => [id, facts.openFindings]));
  const mergeFailureByEpic = mergeFacts;

  /* ---- 13. running / queued sessions -------------------------------- */

  // The one deliberately unindexed scan (`status` has no index): its answer
  // must not be truncated, and it reads only narrow columns (~0.1 ms).
  // `last_non_empty_text` is UNCAPPED at the write side — a CLI emitting one
  // 4 MB line stores 4 MB — so the clip happens in SQL. The indexed last-chunk lookup below supplies the live activity sort;
  // no watchdog sweep or stale-state mutation runs on this read path.
  const activeRows = readActiveSessionRows(db, scopedProjectIds);

  const sessionRows: RegistrySessionRow[] = activeRows.map((session) => ({
    ...session,
    activityAt: getSessionLastActivityAt(session),
  }));

  /* ---- 14. failures ------------------------------------------------- */

  const cutoff = lookbackCutoff(now, CONTROL_DESK_LOOKBACK_DAYS);

  const failureSessions = readLatestFailureSessions(db, scopedProjectIds, cutoff);

  /* ---- 15. dependency edges ----------------------------------------- */

  // Edges never cross projects (`CrossProjectError`), so per-project sets union
  // safely. Lands on `ticket_dependencies_project_idx`.
  const edges: TicketDependencyEdge[] = db
    .select({
      ticketId: ticketDependencies.ticketId,
      dependsOnTicketId: ticketDependencies.dependsOnTicketId,
    })
    .from(ticketDependencies)
    .where(inArray(ticketDependencies.projectId, scopedProjectIds))
    .all();

  // Read only the prerequisite identity/status projection. A delivered
  // prerequisite may be outside either window (or excluded by search); it
  // must still satisfy its edges without becoming a row in the response.
  const dependencyEpics = db
    .selectDistinct({
      id: epics.id,
      projectId: epics.projectId,
      status: epics.status,
      readableId: epics.readableId,
      title: epics.title,
    })
    .from(ticketDependencies)
    .innerJoin(epics, eq(ticketDependencies.dependsOnTicketId, epics.id))
    .where(inArray(ticketDependencies.projectId, scopedProjectIds))
    .all();

  /* ---- 16. release versions ----------------------------------------- */

  const releaseIds = [
    ...new Set(
      releasedRows
        .map((row) => row.releaseId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];

  const releaseVersionById = new Map<string, string>();
  if (releaseIds.length > 0) {
    // Primary-key lookup: `epics.release_id -> releases.id`.
    for (const row of db
      .select({ id: releases.id, version: releases.version })
      .from(releases)
      .where(inArray(releases.id, releaseIds))
      .all()) {
      releaseVersionById.set(row.id, row.version);
    }
  }

  /* ---- 17. the footer's 30-day cost --------------------------------- */

  // SUM answers NULL on a quiet month, and that NULL survives to the em-dash —
  // unlike a COUNT over an empty range, which is a real zero.
  const cost30d = db
    .select({ cost: sql<number | null>`SUM(${agentSessions.totalCostUsd})`.as("cost") })
    .from(agentSessions)
    .where(
      and(
        inArray(agentSessions.projectId, scopedProjectIds),
        storedTimestampSince(agentSessions.createdAt, lookbackCutoff(now, REGISTRY_COST_WINDOW_DAYS)),
      ),
    )
    .get();

  /* ---- derivation ---------------------------------------------------- */

  const registryEpics: RegistryEpicRow[] = baseEpicRows.map((row) => {
    const counts = storyCountsByEpic.get(row.id);
    const session = latestSessionByEpic.get(row.id);
    const freshness = freshnessByEpic.get(row.id);
    const failure = mergeFailureByEpic.get(row.id);
    return {
      ...row,
      usCount: counts?.usCount ?? 0,
      usDone: counts?.usDone ?? 0,
      buildQueue: buildQueueByEpic.get(row.id),
      // The registry never quotes a comment, so the content query is not run
      // and these three stay null. `isAwaitingReply` does not read them.
      latestCommentId: null,
      latestCommentAuthor: null,
      latestCommentContent: null,
      latestCommentCreatedAt: null,
      latestSessionOutcome: session?.outcome ?? null,
      latestSessionEndedAt: session?.endedAt ?? null,
      latestUserCommentCreatedAt: latestUserCommentByEpic.get(row.id) ?? null,
      openFindings: openFindingsByEpic.get(row.id) ?? null,
      lastCleanReviewAt: freshness?.lastCleanReviewAt ?? null,
      lastTerminalCodeAt: freshness?.lastTerminalCodeAt ?? null,
      lastNegativeVerdictReviewAt: freshness?.lastNegativeVerdictReviewAt ?? null,
      supersessionAt: freshness?.supersessionAt ?? null,
      lastMergeConflictAt: failure?.lastMergeConflictAt ?? null,
      lastConflictMarkersAt: failure?.lastConflictMarkersAt ?? null,
    };
  });

  // The DERNIÈRE ACTIVITÉ column is interface copy composed on the server, so
  // this handler resolves it: an API route is the one place that knows the
  // request's locale with no component above it (`lib/i18n/catalogue.ts`).
  // The derivation is handed RESOLVED PHRASES rather than the translator, so
  // every `Registry.activity.*` key stays literal next to this binding.
  const locale = resolveUiLocaleForRequest(request);
  const t = translatorFor(locale, "Registry");
  const activityCopy: ActivityCopy = {
    columns: Object.fromEntries(Object.entries(COLUMN_LABEL_KEYS).map(([status, key]) => [status, catalogueValue(locale, key)])),
    running: (line) => t("activity.running", { line }),
    question: (age) => t("activity.question", { age }),
    failed: (error, age) => t("activity.failed", { error, age }),
    failedFallback: t("activity.failedFallback"),
    conflict: (branch, age) => t("activity.conflict", { branch, age }),
    branchUnknown: t("activity.branchUnknown"),
    blocked: (age) => t("activity.blocked", { age }),
    created: (age) => t("activity.created", { age }),
    updated: (age) => t("activity.updated", { age }),
    merged: (age) => t("activity.merged", { age }),
    released: (age) => t("activity.released", { age }),
    reviewClean: t("activity.reviewClean"),
    findings: (count) => t("activity.findings", { count }),
    withPr: (pr, detail) => t("activity.withPr", { pr, detail }),
  };
  const derivedRows = deriveRegistryRows(
    {
      projects: deskProjects,
      epics: registryEpics,
      sessions: sessionRows,
      failureSessions,
      edges,
      dependencyEpics,
      releaseVersionById,
      costByEpicId,
      locale,
      now,
    },
    activityCopy,
  );
  const rows = derivedRows.filter((row) => !scopedStatus || row.status === scopedStatus);

  // State pills clear the exact filter, so their counts describe that scope.
  // Group totals and the footer describe the current exact filter instead.
  const { counts } = deriveRegistryTotals({ rows: derivedRows, statusCounts });
  const visibleTotals = deriveRegistryTotals({
    rows,
    statusCounts: scopedStatus
      ? new Map([[scopedStatus, statusCounts.get(scopedStatus) ?? 0]])
      : statusCounts,
  });
  const { groupTotals, groupLoaded } = visibleTotals;

  const payload: TicketsRegistryPayload = {
    generatedAt: now.toISOString(),
    projects: deskProjects,
    rows,
    counts,
    groupTotals,
    groupLoaded,
    totals: {
      tickets: visibleTotals.counts.all ?? 0,
      projects: scopedProject ? 1 : deskProjects.length,
      cost30dUsd:
        typeof cost30d?.cost === "number" && Number.isFinite(cost30d.cost)
          ? cost30d.cost
          : null,
    },
  };

  console.debug("[tickets/GET] query profile", {
    projects: deskProjects.length,
    epics: registryEpics.length,
    rows: rows.length,
    queryMs: Date.now() - queryStartedAt,
  });

  return NextResponse.json({ data: payload });
}
