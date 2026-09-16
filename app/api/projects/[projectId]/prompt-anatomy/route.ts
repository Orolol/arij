import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentSessions, epics, namedAgents, userStories } from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { personaSection } from "@/lib/claude/prompt-sections";
import {
  PROMPT_ANATOMY_ORDER,
  estimateTokens,
  toPromptAnatomySegments,
  type PromptTokenBreakdown,
} from "@/lib/tokens/estimator";
import type { PromptAnatomyRow } from "@/lib/types/prompt-anatomy";

/**
 * GET /api/projects/[projectId]/prompt-anatomy
 *
 * "What does each agent actually receive at the start of a session?", in
 * tokens — the data behind frame 8b's ANATOMIE DU PROMPT band.
 *
 * Everything here is READ from what dispatch already persisted: every
 * dispatch path writes `agent_sessions.estimated_prompt_breakdown` (see
 * lib/agent-sessions/lifecycle.ts and its callers). Nothing is re-assembled
 * and nothing is estimated twice — with ONE documented exception, the persona
 * (step 4 below).
 *
 * PERFORMANCE WORKAROUNDS THAT MUST SURVIVE A REFACTOR:
 * - the `.limit(SCAN_LIMIT)` scan cap. The query rides
 *   `agent_sessions_project_created_at_idx`, and the cap is what stops a
 *   long-lived project from walking thousands of rows on every page load.
 * - the epic-type and story-count lookups are BATCHED `IN (…)` selects. One
 *   query per session would put ~400 round-trips on the single synchronous
 *   better-sqlite3 connection every other request shares.
 * - the client re-fetches on the SSE `session:completed` event, never on a
 *   timer: a completed dispatch is exactly when a new breakdown lands.
 */

/** How far back we look for sessions carrying a stored breakdown. */
const SCAN_LIMIT = 400;
/** Rows drawn in the band. The frame's three rows, generalised. */
const MAX_ROWS = 6;

/**
 * Derives the ROLE suffix printed after the agent name (`· BUILD`).
 *
 * There is no bug-specific agent type — a bug ticket is an epic whose `type`
 * is `'bug'` — so the build family has to consult the epic.
 */
function roleFor(agentType: string | null, epicType: string | null): string {
  const type = (agentType ?? "").trim();
  if (!type) return "SESSION";

  if (type === "build" || type === "ticket_build" || type === "team_build") {
    return epicType === "bug" ? "BUG FIX" : "BUILD";
  }
  if (type.startsWith("review_")) return "REVIEW";
  if (type === "merge" || type === "tech_check") return "MERGE FIX";
  if (type === "chat" || type === "spec_generation" || type === "refinement") {
    return "CHAT & SPEC";
  }
  return type.replace(/_/g, " ").toUpperCase();
}

/**
 * Parses a stored breakdown defensively. One legacy row holding garbage must
 * never 500 the page — the row is skipped instead.
 */
function parseBreakdown(raw: string | null): PromptTokenBreakdown | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const num = (key: string) => {
      const value = record[key];
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : 0;
    };
    return {
      spec: num("spec"),
      memory: num("memory"),
      ticket: num("ticket"),
      comments: num("comments"),
      findings: num("findings"),
      documents: num("documents"),
      system: num("system"),
      other: num("other"),
    };
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  // 1. The candidate sessions, newest first, capped.
  const sessions = db
    .select({
      id: agentSessions.id,
      createdAt: agentSessions.createdAt,
      agentType: agentSessions.agentType,
      namedAgentId: agentSessions.namedAgentId,
      namedAgentName: agentSessions.namedAgentName,
      epicId: agentSessions.epicId,
      estimatedPromptBreakdown: agentSessions.estimatedPromptBreakdown,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        isNotNull(agentSessions.estimatedPromptBreakdown),
      ),
    )
    .orderBy(desc(agentSessions.createdAt))
    .limit(SCAN_LIMIT)
    .all();

  if (sessions.length === 0) {
    return NextResponse.json(
      { data: { rows: [] } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 2. Batched epic types — the build family needs them to tell BUILD from
  //    BUG FIX. One query, never one per session.
  const epicIds = [
    ...new Set(sessions.map((s) => s.epicId).filter((id): id is string => !!id)),
  ];
  const epicTypeById = new Map<string, string | null>();
  if (epicIds.length > 0) {
    for (const row of db
      .select({ id: epics.id, type: epics.type })
      .from(epics)
      .where(inArray(epics.id, epicIds))
      .all()) {
      epicTypeById.set(row.id, row.type ?? null);
    }
  }

  // 3. Group by (agent, role), newest session per group. The list is already
  //    DESC, so the first row of a group wins.
  interface Candidate {
    sessionId: string;
    createdAt: string | null;
    agentId: string | null;
    agentName: string;
    role: string;
    epicId: string | null;
    breakdown: PromptTokenBreakdown;
  }
  const byGroup = new Map<string, Candidate>();

  for (const session of sessions) {
    const breakdown = parseBreakdown(session.estimatedPromptBreakdown);
    if (!breakdown) continue;

    const role = roleFor(
      session.agentType,
      session.epicId ? (epicTypeById.get(session.epicId) ?? null) : null,
    );
    const agentKey = session.namedAgentId ?? session.namedAgentName ?? "—";
    const key = `${agentKey}\u0000${role}`;
    if (byGroup.has(key)) continue;

    byGroup.set(key, {
      sessionId: session.id,
      createdAt: session.createdAt ?? null,
      agentId: session.namedAgentId ?? null,
      // An unnamed dispatch has no identity to print; the em dash is the
      // house answer for "unavailable", never a fabricated label.
      agentName: session.namedAgentName ?? "—",
      role,
      epicId: session.epicId ?? null,
      breakdown,
    });
  }

  const candidates = [...byGroup.values()];

  // 4. PERSONA is computed HERE, not read from the row: process-manager
  //    prepends it at spawn time, AFTER the dispatch-time estimate is taken,
  //    so a stored breakdown never contains it and `system` never
  //    double-counts it. NamedAgentLite does not carry personaPrompt — select
  //    it from the table directly.
  const agentIds = [
    ...new Set(candidates.map((c) => c.agentId).filter((id): id is string => !!id)),
  ];
  const personaTokensByAgent = new Map<string, number>();
  if (agentIds.length > 0) {
    for (const row of db
      .select({ id: namedAgents.id, personaPrompt: namedAgents.personaPrompt })
      .from(namedAgents)
      .where(inArray(namedAgents.id, agentIds))
      .all()) {
      personaTokensByAgent.set(
        row.id,
        estimateTokens(personaSection(row.personaPrompt)),
      );
    }
  }

  // 5. Fold onto the six drawn segments, drop the empty rows, rank, cap.
  const scored = candidates
    .map((candidate) => {
      const segments = toPromptAnatomySegments(
        candidate.breakdown,
        candidate.agentId
          ? (personaTokensByAgent.get(candidate.agentId) ?? 0)
          : 0,
      );
      const total = PROMPT_ANATOMY_ORDER.reduce(
        (sum, key) => sum + segments[key],
        0,
      );
      return { candidate, segments, total };
    })
    // An all-zero breakdown is skipped, never drawn as a row of zeros.
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_ROWS);

  // 6. Annotations — best-effort, and only the two that are derivable.
  //    The frame's `bug + repro` and `diff +229 −18` need a repro marker and a
  //    live worktree diffstat this route has no access to; a segment with no
  //    derivable annotation simply shows its token count.
  const annotatedEpicIds = [
    ...new Set(
      scored
        .map((entry) => entry.candidate.epicId)
        .filter((id): id is string => !!id),
    ),
  ];
  const storyCountByEpic = new Map<string, number>();
  if (annotatedEpicIds.length > 0) {
    for (const row of db
      .select({
        epicId: userStories.epicId,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(userStories)
      .where(inArray(userStories.epicId, annotatedEpicIds))
      .groupBy(userStories.epicId)
      .all()) {
      if (row.epicId) storyCountByEpic.set(row.epicId, Number(row.count) || 0);
    }
  }

  const rows: PromptAnatomyRow[] = scored.map(({ candidate, segments, total }) => {
    const annotations: PromptAnatomyRow["annotations"] = {};

    const stories = candidate.epicId
      ? (storyCountByEpic.get(candidate.epicId) ?? 0)
      : 0;
    if (stories > 0) {
      annotations.ticket = `epic + ${stories} ${stories === 1 ? "story" : "stories"}`;
    }
    if (candidate.role === "REVIEW") {
      annotations.system = "review rubric";
    }

    return {
      agentId: candidate.agentId,
      agentName: candidate.agentName,
      role: candidate.role,
      segments,
      annotations,
      // The bar draws the SUM. Using the stored estimatedPromptTokens would
      // make the numeral disagree with the bar: it excludes the persona and,
      // on the review path, some routes store an aggregate over several
      // review types.
      total,
      sampledAt: candidate.createdAt,
      sessionId: candidate.sessionId,
    };
  });

  return NextResponse.json(
    { data: { rows } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
