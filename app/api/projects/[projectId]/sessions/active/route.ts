import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions, epics, userStories } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getSessionStatusForApi } from "@/lib/agent-sessions/lifecycle";
import {
  classifySessionActivity,
  type UnifiedActivity,
} from "@/lib/agent-sessions/active-activity";
import { activityRegistry } from "@/lib/activity-registry";
import {
  getSessionLastActivityAt,
  isSessionStale,
} from "@/lib/agents/watchdog";
import { DREAMING_AGENT_TYPE } from "@/lib/workflow/dreaming-constants";

/**
 * WHAT THIS DELIBERATELY DOES NOT READ: `agent_sessions.prompt`.
 *
 * The last resort here used to be three substring tests over the whole
 * prompt — "merge conflict" / "git merge main" -> MERGE, and a regex for the
 * review header -> REVIEW. The column was selected for every running and
 * queued session to serve them, lowercased into a second full copy, and
 * thrown away; it was never returned to the client.
 *
 * 1. COST. Measured on the live database (2026-09-05): 1053 sessions carry a
 *    prompt, 77.58 MB in total, 73.7 KB on average, 4.96 MB largest. For the
 *    7 sessions then active — 704 KB of prompt — one poll of this route cost
 *    3.42 ms with the column and 0.07 ms without it. Pushing the tests into
 *    SQL (`instr(lower(prompt), …)`) only reached 1.69 ms and a
 *    `substr(prompt, 1, 40000)` prefix 1.26 ms, because SQLite still has to
 *    read the blob off the page store and `lower()` it. better-sqlite3 is
 *    synchronous on one shared connection, so that time is the whole event
 *    loop — every other request, every SSE heartbeat — on a route the
 *    monitor polls.
 *
 * 2. IT WAS WRONG ANYWAY. Every branch above catches the sessions the
 *    heuristic claimed to classify, so it could only ever fire on one it had
 *    already been proven wrong about. On that same database: all 15 sessions
 *    whose prompt IS the merge-resolution prompt carry `agent_type =
 *    "merge"`; all 198 carrying the review header carry `review_code` or
 *    `review_feature`; no row has a NULL `agent_type` at all. Of the 515
 *    sessions that did reach the fallback, 389 fired the merge test — 212
 *    `ticket_build`, 172 `build`, 4 `forensic`, 1 `spec_generation`. Every
 *    prompt carries the project spec and memory, so a project whose spec says
 *    the words "merge conflict" turned three quarters of its builds into
 *    "Merging" cards.
 *
 * `lib/control-desk/aggregate.ts`'s `inferTaskType` dropped the same tests for
 * the same reasons. Both now read {@link classifySessionActivity} — the two
 * classifications are one function, spelled differently at each surface.
 *
 * Pinned by `__tests__/sessions-active-route-projection.test.ts`.
 */
function buildDbActivityLabel(
  type: UnifiedActivity["type"],
  row: {
    storyTitle: string | null;
    epicTitle: string | null;
    agentType?: string | null;
  }
): string {
  if (type === "release") {
    return "Generating release notes";
  }

  if (type === "memory") {
    // Neither carries an epicId (both are project-level background passes), so
    // there is no ticket to name — the agent type IS the whole story.
    return row.agentType === DREAMING_AGENT_TYPE
      ? "Dreaming: rewriting project memory"
      : "Distilling project memory";
  }

  if (type === "grading") {
    return row.epicTitle
      ? `Grading: ${row.epicTitle}`
      : "Grading acceptance criteria";
  }

  if (type === "refinement") {
    // Project-level pass over the planning columns — no ticket to name.
    return "Refining the board";
  }

  if (type === "qa") {
    if (row.agentType === "failure_digest") {
      return "Analyzing recurring failures";
    }
    return row.agentType === "e2e_test"
      ? "Running E2E test"
      : "Running tech check";
  }

  if (type === "merge") {
    return row.epicTitle ? `Merging: ${row.epicTitle}` : "Merging";
  }

  if (type === "review") {
    return row.storyTitle
      ? `Reviewing: ${row.storyTitle}`
      : row.epicTitle
        ? `Reviewing: ${row.epicTitle}`
        : "Reviewing";
  }

  return row.storyTitle
    ? `Building: ${row.storyTitle}`
    : row.epicTitle
      ? `Building: ${row.epicTitle}`
      : "Building";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  // DB sessions with LEFT JOINs for labels. Queued sessions are active work
  // too (the scheduler is holding them for a slot), so monitors can render
  // them alongside running ones — distinguished by `status`.
  //
  // An explicit projection, and `agent_sessions.prompt` is the reason it is
  // one: nothing here returns it, and nothing here reads it any more either.
  // See `inferDbActivityType` above for the measurement.
  const rows = db
    .select({
      id: agentSessions.id,
      epicId: agentSessions.epicId,
      userStoryId: agentSessions.userStoryId,
      status: agentSessions.status,
      mode: agentSessions.mode,
      agentType: agentSessions.agentType,
      orchestrationMode: agentSessions.orchestrationMode,
      provider: agentSessions.provider,
      namedAgentName: agentSessions.namedAgentName,
      startedAt: agentSessions.startedAt,
      createdAt: agentSessions.createdAt,
      epicTitle: epics.title,
      storyTitle: userStories.title,
    })
    .from(agentSessions)
    .leftJoin(epics, eq(agentSessions.epicId, epics.id))
    .leftJoin(userStories, eq(agentSessions.userStoryId, userStories.id))
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, ["running", "queued"])
      )
    )
    .all();

  const now = new Date();

  const dbActivities: UnifiedActivity[] = rows.map((row) => {
    const type = classifySessionActivity(row);
    const label =
      row.orchestrationMode === "team"
        ? "Team Build"
        : buildDbActivityLabel(type, row);

    // Staleness only means something for sessions that should be
    // producing output — queued sessions are silent by design.
    const isRunning = row.status === "running";
    const lastActivityAt = getSessionLastActivityAt(row);

    return {
      id: row.id,
      epicId: row.epicId ?? null,
      userStoryId: row.userStoryId ?? null,
      type,
      label,
      status: getSessionStatusForApi(row.status),
      mode: row.mode || "code",
      provider: row.provider || "claude-code",
      namedAgentName: row.namedAgentName ?? null,
      // Queued sessions have no startedAt yet — fall back to enqueue time.
      startedAt: row.startedAt || row.createdAt || new Date().toISOString(),
      source: "db" as const,
      cancellable: true,
      lastActivityAt,
      stale: isRunning && isSessionStale(lastActivityAt, row.agentType, now),
    };
  });

  // Registry activities (chat, spec gen, releases)
  const registryActivities: UnifiedActivity[] = activityRegistry
    .listByProject(projectId)
    .map((a) => ({
      id: a.id,
      epicId: null,
      userStoryId: null,
      type: a.type,
      label: a.label,
      status: "running",
      mode: "plan",
      provider: a.provider,
      namedAgentName: a.namedAgentName ?? null,
      startedAt: a.startedAt,
      source: "registry" as const,
      cancellable: !!a.kill,
      lastActivityAt: null,
      stale: false,
    }));

  return NextResponse.json({ data: [...dbActivities, ...registryActivities] });
}
