import { autoModeRegistry } from "@/lib/auto-mode/registry";
import { readActiveSessionRows, readEpicComments, readMergeFacts } from "@/lib/control-desk/read-model";
import { hasUnreadAiComment } from "@/lib/kanban/unread-ai";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionLastActivityAt, isSessionStale } from "@/lib/agents/watchdog";
import {
  AUTO_MODE_ENABLED_SETTING_KEY,
  autoModeEnabledSettingKey,
  parseAutoModeEnabled,
} from "@/lib/auto-mode/constants";
import {
  applyDeskDismissals,
  deriveAwaitingReply,
  deriveConflicts,
  deriveFailures,
  deriveProjects,
  deriveQueued,
  deriveReadyToLand,
  deriveToday,
  deriveUpNext,
  deriveWorking,
  type DeskDismissalRow,
  type EpicRow,
  type SessionRow,
} from "@/lib/control-desk/aggregate";
import { lookbackCutoff, readEpicActivityFacts, readLatestFailureSessions } from "@/lib/control-desk/read-model";
import {
  CONTROL_DESK_LOOKBACK_DAYS,
  type ControlDeskPayload
} from "@/lib/control-desk/types";
import { db } from "@/lib/db";
import {
  agentSessions,
  deskDismissals,
  epics,
  projects,
  settings,
  ticketActivityLog,
  ticketDependencies,
  ticketReadCursors
} from "@/lib/db/schema";
import { BUILDABLE_EPIC_STATUSES } from "@/lib/kanban/build-work";
import type { TicketDependencyEdge } from "@/lib/types/kanban";

/**
 * GET /api/control-desk — everything the "Now" desk shows, for every project.
 *
 * WHY ONE ROUTE. better-sqlite3 is synchronous on ONE shared connection
 * (lib/db/index.ts). Fanning out to the per-project board/session routes would
 * run N sequential board queries per poll and block the event loop for the
 * whole app — SSE heartbeats included. So the desk aggregates here, in the
 * shape `/api/inbox` already established: whole-table queries with a `projects`
 * join, derivations in JS from the shared pure helpers.
 *
 * WHY POLLING, NOT SSE. `lib/events/bus.ts` keeps a `Map<projectId, listeners>`
 * and `emit()` returns early for a project nobody listens to; there is no
 * wildcard room and only a per-project SSE endpoint. N EventSources would cost
 * one long-lived HTTP/1.1 connection per project and starve the page at ~6.
 * The client polls this route every few seconds instead.
 *
 * SCAN DISCIPLINE. Every query here carries a bound that an INDEX can use,
 * and the shape of the bound is chosen per table rather than copied:
 *
 * - `agent_sessions` has exactly two secondary indexes: `(project_id,
 *   created_at)` and `(epic_id)`. A bare `created_at >= cutoff` does NOT prune
 *   — `created_at` is the second column of a composite whose first column is
 *   unconstrained — so every time-bounded scan also carries `project_id IN
 *   (<the desk's projects>)`, which turns the full scan into one index range
 *   per project. Measured on the developer's 962 MB board (761 sessions,
 *   77 KB average prompt): `newestSessionAt` went 12.0 ms -> 0.26 ms from that
 *   one clause. The `project_id IN` list is every row of `projects`, so it
 *   removes no session — sessions carry a NOT NULL FK to a project.
 *
 * - the per-epic fact queries (latest comment, latest session, latest user
 *   comment, story counts) scan by `epic_id IN (<the epics this response
 *   renders>)`, which lands on `ticket_comments_epic_idx`,
 *   `agent_sessions_epic_idx` and `user_stories_epic_position_idx`. That is a
 *   TIGHTER bound than a time cutoff AND an exact one: the outer query joins
 *   those facts onto the same id set, so restricting them drops only rows the
 *   join would have thrown away. A time cutoff would not be exact — it would
 *   silence the unread badge on a three-week-old agent comment — and the desk
 *   must agree with `/api/inbox`, which computes the same two signals.
 *
 * - the merge-readiness scans by `epic_id IN (<to_merge epics>)`, tighter
 *   still. Exactness matters twice over there: those facts are MAX over an
 *   epic's whole history, and truncating it would make an old
 *   `changes_requested` verdict vanish and the ticket read as ready to merge.
 *
 * - the ONE deliberately unindexed scan is the running/queued session read.
 *   `status` carries no index, so it is a table scan — but it is the scan
 *   whose answer must not be truncated (a session queued three weeks ago is
 *   still queued, and hiding it is the bug), and it reads only narrow columns,
 *   so it costs ~0.1 ms on that same board.
 *
 * NEVER SELECT `prompt`. It averages 77 KB and reaches 5 MB on that board, and
 * this route is polled every 4 s from two pages. Nothing the desk renders
 * needs it: see `inferTaskType` in lib/control-desk/aggregate.ts for why the
 * dispatch role comes from `agent_type` / `orchestration_mode` / `mode`.
 */

/** 00:00 UTC of the current day, as a lexicographic floor. */
function startOfTodayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Characters of a ticket comment the SQL reads.
 *
 * `excerpt()` in lib/control-desk/aggregate.ts clips the quote to 200 after
 * collapsing whitespace, so twice that is more than the clip can ever consume
 * — and it keeps an uncapped comment body out of the poll.
 */
const COMMENT_EXCERPT_SCAN = 400;

export async function GET() {
  const queryStartedAt = Date.now();
  const now = new Date();
  const cutoff = lookbackCutoff(now, CONTROL_DESK_LOOKBACK_DAYS);
  const todayFloor = startOfTodayUtc(now);

  /* ---- projects ---------------------------------------------------- */

  const projectRows = db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .all();

  /**
   * The `project_id IN (...)` bound every cross-project session scan carries.
   *
   * It is not a filter — `agent_sessions.project_id` is NOT NULL with a
   * cascading FK, so every session is in this list. It exists to give the
   * planner the leading column of `agent_sessions(project_id, created_at)`,
   * without which a `created_at >= cutoff` clause prunes nothing.
   */
  const projectIds = projectRows.map((row) => row.id);

  /* ---- WORKING / QUEUED -------------------------------------------- */

  // `last_non_empty_text` is UNCAPPED at the write side — a CLI emitting one
  // 4 MB line stores 4 MB, which is why the sessions LIST route reduces it to a
  // boolean. The desk actually prints the line, so it takes a substring in SQL
  // and never selects the raw column. `prompt` has the same shape and is not
  // selected at all — see the NEVER SELECT `prompt` note above.
  const activeRows = readActiveSessionRows(db);

  const sessionRows: SessionRow[] = activeRows.map((row) => ({
    ...row,
    // Same watchdog predicate the agent monitor uses, so the desk's stale
    // marker and the stall notification can never disagree.
    stale:
      row.status === "running" &&
      isSessionStale(getSessionLastActivityAt(row), row.agentType, now),
  }));

  const working = deriveWorking(sessionRows);
  const queued = deriveQueued(sessionRows);

  // Full Auto is PER PROJECT (app/api/projects/[projectId]/auto-mode). There is
  // no global flag, so the header pill reports "N/M projects on" and its
  // popover toggles them one by one.
  const autoModeSettings = db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(sql`${settings.key} LIKE ${`${AUTO_MODE_ENABLED_SETTING_KEY}%`}`)
    .all();
  const autoModeByKey = new Map(autoModeSettings.map((row) => [row.key, row.value]));
  const globalAutoMode =
    parseAutoModeEnabled(autoModeByKey.get(AUTO_MODE_ENABLED_SETTING_KEY)) ?? false;

  // The rail's per-project agent count is `sessionRows` grouped, not its own
  // GROUP BY over `agent_sessions`: that query scanned the same table for the
  // same universe (`status = 'running'` is a subset of the rows just read) and
  // could disagree with the WORKING band if a session ended between the two.
  const activeAgentsByProject = new Map<string, number>();
  for (const row of sessionRows) {
    if (row.status !== "running") continue;
    activeAgentsByProject.set(
      row.projectId,
      (activeAgentsByProject.get(row.projectId) ?? 0) + 1,
    );
  }

  const deskProjects = deriveProjects(
    projectRows.map((row) => ({
      ...row,
      activeAgents: activeAgentsByProject.get(row.id) ?? 0,
      autoModeEnabled:
        parseAutoModeEnabled(autoModeByKey.get(autoModeEnabledSettingKey(row.id))) ??
        globalAutoMode,
    })),
  );

  /** Any session owning a ticket, queued included — the merge-suppression set. */
  const busyEpicIds = new Set(
    sessionRows.filter((row) => row.epicId).map((row) => row.epicId as string),
  );
  const runningEpicIds = new Set(
    sessionRows
      .filter((row) => row.status === "running" && row.epicId)
      .map((row) => row.epicId as string),
  );

  /* ---- epics (the /api/inbox shape, cross-project) ------------------ */

  // Phase 1: the epics themselves. The `projects` join plus
  // `epics_project_status_position_idx` keep this to the board's own rows, and
  // the id set it yields is the bound every per-epic fact query below carries.
  const baseEpicRows = db
    .select({
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
      lastReadAt: ticketReadCursors.lastReadAt,
    })
    .from(epics)
    .innerJoin(projects, eq(epics.projectId, projects.id))
    .leftJoin(ticketReadCursors, eq(epics.id, ticketReadCursors.epicId))
    .orderBy(epics.position)
    .all();

  const epicIds = baseEpicRows.map((row) => row.id);

  // Phase 2: the per-epic facts. These were LEFT JOINed subqueries, which made
  // each one a scan of its whole table on every 4 s poll; splitting them out
  // lets each carry `epic_id IN (<the ids above>)` and land on that table's
  // epic index. The join result is unchanged — the outer join kept only these
  // ids anyway.
  const latestCommentByEpic = readEpicComments(db, epicIds, COMMENT_EXCERPT_SCAN);
  const { latestSessionByEpic, latestUserCommentByEpic, storyCountsByEpic, buildQueueByEpic, awaitingReplyByEpic } =
    readEpicActivityFacts(db, epicIds, projectIds, baseEpicRows.filter((epic) => BUILDABLE_EPIC_STATUSES.has(epic.status ?? "")));

  const epicRows = baseEpicRows.map((row) => {
    const comment = latestCommentByEpic.get(row.id);
    const session = latestSessionByEpic.get(row.id);
    const counts = storyCountsByEpic.get(row.id);
    return {
      ...row,
      usCount: counts?.usCount ?? 0,
      usDone: counts?.usDone ?? 0,
      buildQueue: buildQueueByEpic.get(row.id),
      awaitingReply: awaitingReplyByEpic.get(row.id) ?? false,
      latestCommentId: comment?.id ?? null,
      latestCommentAuthor: comment?.author ?? null,
      latestCommentContent: comment?.content ?? null,
      latestCommentCreatedAt: comment?.createdAt ?? null,
      latestSessionOutcome: session?.outcome ?? null,
      latestSessionEndedAt: session?.endedAt ?? null,
      latestUserCommentCreatedAt: latestUserCommentByEpic.get(row.id) ?? null,
    };
  });

  /* ---- merge readiness, for the `to_merge` slice only --------------- */

  const toMergeIds = epicRows
    .filter((row) => row.status === "to_merge")
    .map((row) => row.id);

  const mergeFactsById = readMergeFacts(db, toMergeIds);

  const deskEpics: EpicRow[] = epicRows.map((row) => {
    const facts = mergeFactsById.get(row.id);
    return {
      ...row,
      openFindings: facts?.openFindings ?? null,
      lastCleanReviewAt: facts?.lastCleanReviewAt ?? null,
      lastTerminalCodeAt: facts?.lastTerminalCodeAt ?? null,
      lastNegativeVerdictReviewAt: facts?.lastNegativeVerdictReviewAt ?? null,
      supersessionAt: facts?.supersessionAt ?? null,
      lastMergeConflictAt: facts?.lastMergeConflictAt ?? null,
      lastConflictMarkersAt: facts?.lastConflictMarkersAt ?? null,
    };
  });
  const epicsById = new Map(deskEpics.map((epic) => [epic.id, epic]));

  /* ---- FAILED rows -------------------------------------------------- */

  const failureSessions = readLatestFailureSessions(db, projectIds, cutoff);

  /* ---- TODAY -------------------------------------------------------- */

  // `to_status IN ('done','released')` in ticket_activity_log, not
  // /api/dashboard/summary's `yesterday`: that one is a ROLLING 24h count of
  // SESSIONS, which is neither calendar-today nor shipped tickets.
  const shipped = db
    .select({ shipped: sql<number>`COUNT(DISTINCT ${ticketActivityLog.epicId})`.as("shipped") })
    .from(ticketActivityLog)
    .where(
      and(
        inArray(ticketActivityLog.projectId, projectIds),
        inArray(ticketActivityLog.toStatus, ["done", "released"]),
        sql`${ticketActivityLog.fromStatus} IS NOT ${ticketActivityLog.toStatus}`,
        sql`${ticketActivityLog.createdAt} >= ${todayFloor}`,
      ),
    )
    .get();

  const todaySessions = db
    .select({
      sessions: sql<number>`COUNT(*)`.as("sessions"),
      // COUNT over an empty range is 0; a bare SUM over the same empty range
      // is NULL, and the tile would print "— failed" beside "0 sessions" on a
      // quiet day. This figure is AVAILABLE and it is zero, so it is coalesced
      // — unlike `cost` below, where the NULL is the honest answer.
      failed:
        sql<number>`COALESCE(SUM(CASE WHEN ${agentSessions.status} = 'failed' THEN 1 ELSE 0 END), 0)`.as(
          "failed",
        ),
      // SUM answers NULL when nothing in range reported a cost. That NULL is
      // load-bearing: the tile renders an em-dash, never a zero.
      cost: sql<number | null>`SUM(${agentSessions.totalCostUsd})`.as("cost"),
      projects: sql<number>`COUNT(DISTINCT ${agentSessions.projectId})`.as("projects"),
    })
    .from(agentSessions)
    .where(
      and(
        inArray(agentSessions.projectId, projectIds),
        sql`${agentSessions.createdAt} >= ${todayFloor}`,
      ),
    )
    .get();

  /* ---- UP NEXT ------------------------------------------------------ */

  // Edges never cross projects (lib/dependencies/validation.ts raises
  // CrossProjectError), so per-project edge sets union safely: no global graph,
  // no global cycle check. The `project_id IN` bound is what makes that claim
  // structural rather than incidental, and it lands on
  // `ticket_dependencies_project_idx`.
  const edges: TicketDependencyEdge[] = db
    .select({
      ticketId: ticketDependencies.ticketId,
      dependsOnTicketId: ticketDependencies.dependsOnTicketId,
    })
    .from(ticketDependencies)
    .where(inArray(ticketDependencies.projectId, projectIds))
    .all();

  const { rows: readyToLand, heldBackCount } = deriveReadyToLand(deskEpics, busyEpicIds);

  /* ---- YOUR TURN ---------------------------------------------------- */

  // Bounded by the epics already in hand, so this stays one indexed lookup on
  // the (epic_id, kind) primary key rather than a scan of the whole table.
  const dismissals: DeskDismissalRow[] = deskEpics.length
    ? db
        .select({
          epicId: deskDismissals.epicId,
          kind: deskDismissals.kind,
          signalAt: deskDismissals.signalAt,
        })
        .from(deskDismissals)
        .where(
          inArray(
            deskDismissals.epicId,
            deskEpics.map((epic) => epic.id),
          ),
        )
        .all()
    : [];

  // Derive first, then subtract what the user has waved off: the dismissal is
  // a read-side filter and must never change how a signal is computed.
  const derived = {
    awaitingReply: deriveAwaitingReply(deskEpics),
    failed: deriveFailures(failureSessions, epicsById, runningEpicIds),
    conflicts: deriveConflicts(deskEpics),
  };
  const yourTurn = {
    ...applyDeskDismissals(derived, dismissals),
    parked: deskProjects.flatMap((project) => autoModeRegistry.listParked(project.id).flatMap((ticket) => {
      const epic = epicsById.get(ticket.epicId);
      return epic ? [{ ...ticket, projectId: project.id, title: epic.title, readableId: epic.readableId }] : [];
    })),
  };

  const payload: ControlDeskPayload = {
    generatedAt: now.toISOString(),
    inboxUnreadCount: epicRows.filter((epic) => hasUnreadAiComment(epic) || awaitingReplyByEpic.get(epic.id)).length,
    projects: deskProjects,
    working,
    queued,
    today: deriveToday({
      ticketsShipped: shipped?.shipped ?? null,
      failedSessions: todaySessions?.failed ?? null,
      costUsd: todaySessions?.cost ?? null,
      projects: todaySessions?.projects ?? null,
      sessions: todaySessions?.sessions ?? null,
    }),
    yourTurn,
    readyToLand,
    heldBackCount,
    upNext: deriveUpNext(deskProjects, deskEpics, edges, busyEpicIds),
  };

  console.debug("[control-desk/GET] query profile", {
    projects: deskProjects.length,
    epics: deskEpics.length,
    working: working.length,
    queryMs: Date.now() - queryStartedAt,
  });

  return NextResponse.json({ data: payload });
}
