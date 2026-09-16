import { epicDispatchHold, loadRegistryExclusions } from "@/lib/auto-mode/exclusions";
import { autoModeRegistry } from "@/lib/auto-mode/registry";
import { readReviewRejections } from "@/lib/auto-mode/review-rejections";
import type { ArijDatabase } from "@/lib/db";
import { agentSessions, epics, reviewComments, ticketActivityLog, ticketComments, userStories } from "@/lib/db/schema";
import { isAwaitingReply } from "@/lib/kanban/awaiting-reply";
import { selectBuildWork, type BuildQueueFacts } from "@/lib/kanban/build-work";
import { compareStoredTimestamps, latestActivityTimestamp } from "@/lib/utils/timestamps";
import { blocksMergeSql } from "@/lib/workflow/blocking-findings";
import { CONFLICT_MARKERS_REASON_LIKE_PATTERNS, MERGE_CONFLICT_REASON_LIKE_PATTERNS, MERGE_FAILURE_REASON_LIKE_PATTERNS } from "@/lib/workflow/merge-failure";
import { epicSessionFactsCte } from "@/lib/workflow/review-freshness";
import { and, eq, inArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { FailureSessionRow } from "./aggregate";

export function lookbackCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/**
 * Mixed SQLite/ISO timestamps need an instant comparison. Widen the indexed
 * day-prefix bound by one day: a negative offset can spell a recent UTC
 * instant with yesterday's local date. julianday applies the exact cutoff.
 */
export function storedTimestampSince(column: SQLWrapper, cutoff: string): SQL {
  const earliestLocalDay = new Date(new Date(cutoff).getTime() - 86_400_000).toISOString().slice(0, 10);
  return sql`${column} >= ${earliestLocalDay} AND julianday(${column}) >= julianday(${cutoff})`;
}

/** The id DESC tie-break after a newest-timestamp-then-join query. */
export function keepLatest(held: string | undefined, candidate: string): boolean {
  return held === undefined || candidate > held;
}

/**
 * Shared activity facts for the desk and registry. Scope by rendered epic ids
 * so old unanswered questions remain visible without reading session prompts
 * or comment bodies. MAX-then-join only reads the newest session tie group.
 * Normalize the aggregate and join keys, not the indexed scope predicates:
 * SQLite/ISO timestamps and offset spellings must rank by the same instant.
 */
export function readEpicActivityFacts(
  db: ArijDatabase,
  epicIds: string[],
  projectIds: string[],
  queueEpics: readonly { id: string; projectId: string; status: string | null }[] = [],
  includeAwaitingReply = true,
) {
  const latestSessionByEpic = new Map<string, { outcome: string | null; endedAt: string | null }>();
  const latestUserCommentByEpic = new Map<string, string | null>();
  const storyCountsByEpic = new Map<string, { usCount: number; usDone: number }>();
  const buildQueueByEpic = new Map<string, BuildQueueFacts>();
  const queueEpicIds = includeAwaitingReply ? epicIds : queueEpics.map((epic) => epic.id);
  const awaitingReplyByEpic = new Map<string, boolean>();

  if (epicIds.length > 0) {
    const scope = and(
      inArray(agentSessions.epicId, epicIds),
      inArray(agentSessions.projectId, projectIds),
    );
    // Only queue parents need per-story questions. Other epics retain one
    // latest-session group, so delivered history does not enlarge this read.
    const queueStoryId = queueEpicIds.length
      ? sql<string | null>`CASE WHEN ${inArray(agentSessions.epicId, queueEpicIds)} THEN ${agentSessions.userStoryId} END`
      : sql<null>`NULL`;
    const newestSessionAt = db
      .select({
        epicId: agentSessions.epicId,
        queueStoryId: queueStoryId.as("queue_story_id"),
        newestAt: sql<number>`MAX(julianday(${agentSessions.createdAt}))`.as("newest_epic_session_at"),
      })
      .from(agentSessions)
      .where(scope)
      .groupBy(agentSessions.epicId, queueStoryId)
      .as("newest_epic_session_at");
    const sessionRows = db
      .select({
        epicId: agentSessions.epicId,
        id: agentSessions.id,
        userStoryId: agentSessions.userStoryId,
        createdAt: agentSessions.createdAt,
        outcome: agentSessions.outcome,
        endedAt: sql<string | null>`COALESCE(
          ${agentSessions.endedAt}, ${agentSessions.completedAt}, ${agentSessions.createdAt}
        )`,
      })
      .from(agentSessions)
      .innerJoin(newestSessionAt, and(
        eq(agentSessions.epicId, newestSessionAt.epicId),
        sql`${queueStoryId} IS ${newestSessionAt.queueStoryId}`,
        eq(sql`julianday(${agentSessions.createdAt})`, newestSessionAt.newestAt),
      ))
      .where(scope)
      .all();
    const latestByEpic = new Map<string, (typeof sessionRows)[number]>();
    const latestQueueByTarget = new Map<string, (typeof sessionRows)[number]>();
    for (const row of sessionRows) {
      if (!row.epicId) continue;
      const held = latestByEpic.get(row.epicId);
      const byTime = held ? compareStoredTimestamps(row.createdAt, held.createdAt, "desc") : -1;
      if (byTime < 0 || (byTime === 0 && keepLatest(held?.id, row.id))) {
        latestByEpic.set(row.epicId, row);
        latestSessionByEpic.set(row.epicId, { outcome: row.outcome, endedAt: row.endedAt });
      }
      const target = row.userStoryId ? `story:${row.userStoryId}` : `epic:${row.epicId}`;
      if (keepLatest(latestQueueByTarget.get(target)?.id, row.id)) latestQueueByTarget.set(target, row);
    }

    const commentRows = db
      .select({
        epicId: ticketComments.epicId,
        at: sql<string | null>`strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(${ticketComments.createdAt})))`,
      })
      .from(ticketComments)
      .where(and(inArray(ticketComments.epicId, epicIds), eq(ticketComments.author, "user")))
      .groupBy(ticketComments.epicId)
      .all();
    for (const row of commentRows) {
      if (row.epicId) latestUserCommentByEpic.set(row.epicId, row.at);
    }

    const countRows = db
      .select({
        epicId: userStories.epicId,
        usCount: sql<number>`COUNT(*)`,
        usDone: sql<number>`SUM(CASE WHEN ${userStories.status} = 'done' THEN 1 ELSE 0 END)`,
      })
      .from(userStories)
      .where(inArray(userStories.epicId, epicIds))
      .groupBy(userStories.epicId)
      .all();
    for (const row of countRows) {
      storyCountsByEpic.set(row.epicId, {
        usCount: Number(row.usCount ?? 0),
        usDone: Number(row.usDone ?? 0),
      });
    }

    if (queueEpicIds.length > 0) {
      const { reviewRejectionsByEpic } = readReviewRejections(db, queueEpics.map((epic) => epic.id), latestUserCommentByEpic);
      const policies = new Map([...new Set(queueEpics.map((epic) => epic.projectId))].map((projectId) => [projectId, {
        ...loadRegistryExclusions(projectId),
        parkedTicketIds: autoModeRegistry.parkedTicketIds(projectId),
        reviewRejectionsByEpic,
      }]));
      const stories = db.select({
        id: userStories.id,
        epicId: userStories.epicId,
        status: userStories.status,
        position: userStories.position,
      }).from(userStories).where(inArray(userStories.epicId, queueEpicIds)).all();
      const storiesByEpic = new Map<string, typeof stories>();
      for (const story of stories) {
        const rows = storiesByEpic.get(story.epicId) ?? [];
        rows.push(story);
        storiesByEpic.set(story.epicId, rows);
      }
      const storyReplies = stories.length ? db.select({
        userStoryId: ticketComments.userStoryId,
        at: sql<string | null>`strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(${ticketComments.createdAt})))`,
      }).from(ticketComments)
        .where(and(inArray(ticketComments.userStoryId, stories.map((story) => story.id)), eq(ticketComments.author, "user")))
        .groupBy(ticketComments.userStoryId).all() : [];
      const replyByStory = new Map(storyReplies.map((row) => [row.userStoryId, row.at]));
      const awaiting = (target: string, replyAt: string | null | undefined) => {
        const session = latestQueueByTarget.get(target);
        return isAwaitingReply({
          latestSessionOutcome: session?.outcome ?? null,
          latestSessionEndedAt: session?.endedAt ?? null,
          latestUserCommentCreatedAt: replyAt ?? null,
        });
      };
      for (const epicId of epicIds) {
        const parentReply = latestUserCommentByEpic.get(epicId);
        const asked = awaiting(`epic:${epicId}`, parentReply) || (storiesByEpic.get(epicId) ?? []).some((story) =>
          awaiting(`story:${story.id}`, latestActivityTimestamp(parentReply, replyByStory.get(story.id))));
        awaitingReplyByEpic.set(epicId, asked);
      }
      for (const epic of queueEpics) {
        const children = storiesByEpic.get(epic.id) ?? [];
        const parentReply = latestUserCommentByEpic.get(epic.id);
        const parentAsked = awaiting(`epic:${epic.id}`, parentReply);
        const policy = policies.get(epic.projectId)!;
        const isAsked = (story: (typeof children)[number]) => awaiting(
          `story:${story.id}`, latestActivityTimestamp(parentReply, replyByStory.get(story.id)),
        );
        const unaskedWork = selectBuildWork(epic.status, children, isAsked);
        const work = selectBuildWork(epic.status, children, (story) => isAsked(story) || policy.parkedTicketIds.has(story.id));
        const hold = epicDispatchHold(policy, epic.id) || (unaskedWork !== null && work === null ? "parked" : null);
        buildQueueByEpic.set(epic.id, {
          available: !parentAsked && !hold && work !== null,
          awaitingReply: parentAsked || (unaskedWork === null && selectBuildWork(epic.status, children) !== null),
          ...(hold ? { hold } : {}),
        });
      }
    }
  }

  return { latestSessionByEpic, latestUserCommentByEpic, storyCountsByEpic, buildQueueByEpic, awaitingReplyByEpic };
}

/**
 * Every session in each ticket's newest tie group, including successful and
 * queued retries: selectLatestFailures needs them to clear an earlier failure.
 * Both sides retain the project/time bound for the composite session index.
 */
export function readLatestFailureSessions(
  db: ArijDatabase,
  projectIds: string[],
  cutoff: string,
): FailureSessionRow[] {
  if (projectIds.length === 0) return [];
  const scope = and(
    inArray(agentSessions.projectId, projectIds),
    storedTimestampSince(agentSessions.createdAt, cutoff),
  );
  const newestSessionAt = db
    .select({
      epicId: agentSessions.epicId,
      newestAt: sql<number>`MAX(julianday(${agentSessions.createdAt}))`.as("newest_at"),
    })
    .from(agentSessions)
    .where(and(sql`${agentSessions.epicId} IS NOT NULL`, scope))
    .groupBy(agentSessions.epicId)
    .as("newest_session_at");
  return db
    .select({
      id: agentSessions.id,
      projectId: agentSessions.projectId,
      epicId: agentSessions.epicId,
      status: agentSessions.status,
      error: agentSessions.error,
      agentType: agentSessions.agentType,
      provider: agentSessions.provider,
      namedAgentId: agentSessions.namedAgentId,
      namedAgentName: agentSessions.namedAgentName,
      userStoryId: agentSessions.userStoryId,
      producedOutput: sql<number>`CASE WHEN length(COALESCE(${agentSessions.lastNonEmptyText}, '')) > 0 THEN 1 ELSE 0 END`,
      createdAt: agentSessions.createdAt,
      endedAt: agentSessions.endedAt,
    })
    .from(agentSessions)
    .innerJoin(newestSessionAt, and(
      eq(agentSessions.epicId, newestSessionAt.epicId),
      eq(sql`julianday(${agentSessions.createdAt})`, newestSessionAt.newestAt),
    ))
    .where(scope)
    .all()
    .map((row) => ({ ...row, kind: "agent_session", status: row.status ?? "", producedOutput: row.producedOutput === 1 }));
}

export function readMergeFacts(db: ArijDatabase, epicIds: string[]) {
  const factsById = new Map<
    string,
    {
      openFindings: number | null;
      lastCleanReviewAt: string | null;
      lastTerminalCodeAt: string | null;
      lastNegativeVerdictReviewAt: string | null;
      supersessionAt: string | null;
      lastMergeConflictAt: string | null;
      lastConflictMarkersAt: string | null;
    }
  >();

  if (epicIds.length > 0) {
    const epicSessionFacts = epicSessionFactsCte(db, null, { epicIds: epicIds });

    const openFindingCounts = db
      .select({
        epicId: reviewComments.epicId,
        openFindings: sql<number>`COUNT(*)`.as("open_findings"),
      })
      .from(reviewComments)
      .leftJoin(epicSessionFacts, eq(epicSessionFacts.epicId, reviewComments.epicId))
      .where(
        and(
          inArray(reviewComments.epicId, epicIds),
          eq(reviewComments.status, "open"),
          blocksMergeSql(epicSessionFacts.supersessionAt),
        ),
      )
      .groupBy(reviewComments.epicId)
      .as("open_finding_counts");

    // A failed merge writes no column anywhere: this same-state activity row is
    // the only durable trace (lib/workflow/merge-failure.ts). `reason` carries
    // no index and the table is never pruned, so the `epic_id IN (...)` bound
    // — served by `ticket_activity_log_epic_idx` — is what keeps the LIKEs off
    // a full-table string match.
    const latestMergeFailures = db
      .select({
        epicId: ticketActivityLog.epicId,
        lastMergeConflictAt: sql<string | null>`MAX(CASE WHEN ${or(
          ...MERGE_CONFLICT_REASON_LIKE_PATTERNS.map(
            (pattern) => sql`${ticketActivityLog.reason} LIKE ${pattern} ESCAPE '\\'`,
          ),
        )} THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${ticketActivityLog.createdAt}) END)`.as(
          "last_merge_conflict_at",
        ),
        lastConflictMarkersAt: sql<string | null>`MAX(CASE WHEN ${or(
          ...CONFLICT_MARKERS_REASON_LIKE_PATTERNS.map(
            (pattern) => sql`${ticketActivityLog.reason} LIKE ${pattern} ESCAPE '\\'`,
          ),
        )} THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${ticketActivityLog.createdAt}) END)`.as(
          "last_conflict_markers_at",
        ),
      })
      .from(ticketActivityLog)
      .where(
        and(
          inArray(ticketActivityLog.epicId, epicIds),
          or(
            ...MERGE_FAILURE_REASON_LIKE_PATTERNS.map(
              (pattern) => sql`${ticketActivityLog.reason} LIKE ${pattern} ESCAPE '\\'`,
            ),
          ),
        ),
      )
      .groupBy(ticketActivityLog.epicId)
      .as("latest_merge_failures");

    const factRows = db
      .with(epicSessionFacts)
      .select({
        id: epics.id,
        openFindings: openFindingCounts.openFindings,
        lastCleanReviewAt: epicSessionFacts.lastCleanReviewAt,
        lastTerminalCodeAt: epicSessionFacts.lastTerminalCodeAt,
        lastNegativeVerdictReviewAt: epicSessionFacts.lastNegativeVerdictReviewAt,
        supersessionAt: epicSessionFacts.supersessionAt,
        lastMergeConflictAt: latestMergeFailures.lastMergeConflictAt,
        lastConflictMarkersAt: latestMergeFailures.lastConflictMarkersAt,
      })
      .from(epics)
      .leftJoin(epicSessionFacts, eq(epics.id, epicSessionFacts.epicId))
      .leftJoin(openFindingCounts, eq(epics.id, openFindingCounts.epicId))
      .leftJoin(latestMergeFailures, eq(epics.id, latestMergeFailures.epicId))
      .where(inArray(epics.id, epicIds))
      .all();

    for (const row of factRows) {
      factsById.set(row.id, {
        openFindings: row.openFindings ?? 0,
        lastCleanReviewAt: row.lastCleanReviewAt ?? null,
        lastTerminalCodeAt: row.lastTerminalCodeAt ?? null,
        lastNegativeVerdictReviewAt: row.lastNegativeVerdictReviewAt ?? null,
        supersessionAt: row.supersessionAt ?? null,
        lastMergeConflictAt: row.lastMergeConflictAt ?? null,
        lastConflictMarkersAt: row.lastConflictMarkersAt ?? null,
      });
    }
  }

  return factsById;
}

export function readActiveSessionRows(db: ArijDatabase, projectIds?: string[]) {
  const activeRows = db
    .select({
      id: agentSessions.id,
      projectId: agentSessions.projectId,
      epicId: agentSessions.epicId,
      userStoryId: agentSessions.userStoryId,
      status: agentSessions.status,
      mode: agentSessions.mode,
      agentType: agentSessions.agentType,
      orchestrationMode: agentSessions.orchestrationMode,
      provider: agentSessions.provider,
      namedAgentName: agentSessions.namedAgentName,
      batchRunId: agentSessions.batchRunId,
      startedAt: agentSessions.startedAt,
      endedAt: agentSessions.endedAt,
      completedAt: agentSessions.completedAt,
      createdAt: agentSessions.createdAt,
      lastLogLine: sql<
        string | null
      >`substr(${agentSessions.lastNonEmptyText}, 1, ${240})`.as(
        "last_log_line",
      ),
      epicTitle: epics.title,
      epicReadableId: epics.readableId,
      storyTitle: userStories.title,
    })
    .from(agentSessions)
    .leftJoin(epics, eq(agentSessions.epicId, epics.id))
    .leftJoin(userStories, eq(agentSessions.userStoryId, userStories.id))
    .where(and(inArray(agentSessions.status, ["running", "queued"]), projectIds ? inArray(agentSessions.projectId, projectIds) : undefined))
    .all();

  return activeRows;
}

export function readEpicComments(db: ArijDatabase, epicIds: string[], excerptLimit = 2000) {
  const latestCommentByEpic = new Map<
    string,
    {
      id: string;
      author: string | null;
      content: string | null;
      createdAt: string | null;
    }
  >();
  if (epicIds.length > 0) {
    // `ticket_comments.content` is uncapped user/agent text — 5.5 MB across
    // 1657 rows on the developer's board — and the desk quotes at most
    // QUESTION_LENGTH characters of it. So the clip happens in SQL, the way
    // `last_non_empty_text` is already clipped above; the extra room is for the
    // leading whitespace `excerpt()` collapses before it counts characters.
    // A ROW_NUMBER window would rank every comment of every epic; this ranks
    // none. MAX(created_at) per epic is an index-driven aggregate, the join
    // then reads only the newest comment (or the handful sharing a timestamp),
    // and `keepLatest` applies the window's `id DESC` tie-break to those few.
    // Same answer, 6.2 ms -> 1.0 ms on the developer's board.
    const newestCommentAt = db
      .select({
        epicId: ticketComments.epicId,
        newestAt: sql<number>`MAX(julianday(${ticketComments.createdAt}))`.as(
          "newest_comment_at",
        ),
      })
      .from(ticketComments)
      .where(inArray(ticketComments.epicId, epicIds))
      .groupBy(ticketComments.epicId)
      .as("newest_comment_at");

    const commentRows = db
      .select({
        epicId: ticketComments.epicId,
        latestCommentId: ticketComments.id,
        latestCommentAuthor: ticketComments.author,
        latestCommentContent: sql<
          string | null
        >`substr(${ticketComments.content}, 1, ${excerptLimit})`.as(
          "latest_comment_content",
        ),
        latestCommentCreatedAt: ticketComments.createdAt,
      })
      .from(ticketComments)
      .innerJoin(
        newestCommentAt,
        and(
          eq(ticketComments.epicId, newestCommentAt.epicId),
          eq(sql`julianday(${ticketComments.createdAt})`, newestCommentAt.newestAt),
        ),
      )
      .where(inArray(ticketComments.epicId, epicIds))
      .all();

    for (const row of commentRows) {
      if (!row.epicId) continue;
      if (!keepLatest(latestCommentByEpic.get(row.epicId)?.id, row.latestCommentId)) {
        continue;
      }
      latestCommentByEpic.set(row.epicId, {
        id: row.latestCommentId,
        author: row.latestCommentAuthor,
        content: row.latestCommentContent,
        createdAt: row.latestCommentCreatedAt,
      });
    }

  }

  return latestCommentByEpic;
}
