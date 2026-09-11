import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { processManager } from "@/lib/claude/process-manager";
import { agentScheduler } from "@/lib/agents/scheduler";
import { activityRegistry } from "@/lib/activity-registry";
import { SESSION_CHUNK_PAGE_MAX_BYTES } from "@/lib/agent-sessions/chunks";
import {
  isSessionStreamType,
  SESSION_ARIJ_ACTIONS_VIEW,
  SESSION_CHUNK_PAGE_MAX_LIMIT,
  SESSION_STREAM_TYPES,
} from "@/lib/agent-sessions/session-detail";
import {
  buildSessionDetail,
  readArijActions,
  readChunkPage,
  readChunkTail,
  sessionExistsInProject,
} from "@/lib/agent-sessions/read-session";
import {
  isSessionLifecycleConflictError,
  isSessionNotFoundError,
  markSessionCancelled,
} from "@/lib/agent-sessions/lifecycle";
import { cancelQaReportsForSession } from "@/lib/qa/report-lifecycle";

/**
 * The session detail route: parse the query, pick a reader, serialise. The
 * readers — and every cap they apply — live in
 * `lib/agent-sessions/read-session.ts`; the client contract in
 * `lib/agent-sessions/session-detail.ts`.
 */

function parseLimit(raw: string | null): number | undefined {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, 1), SESSION_CHUNK_PAGE_MAX_LIMIT);
}

/** A sequence number cursor (`?after=`, `?before=`); anything else is "none". */
function parseSequence(raw: string | null): number | null {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * `?offset=` / `?beforeOffset=` are the other half of a cursor: characters of
 * the chunk AT the cursor already delivered (forward) or still undelivered at
 * its head (backward). Non-zero only for a chunk too large to fit one page.
 */
function parseOffset(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/** A comma-separated query list (`?include=`, `?omit=`). */
function parseList(raw: string | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

const notFound = () =>
  NextResponse.json({ error: "Session not found" }, { status: 404 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
) {
  const { projectId, sessionId } = await params;
  const { searchParams } = new URL(request.url);
  const streamParam = searchParams.get("stream");
  const include = parseList(searchParams.get("include"));
  const omit = parseList(searchParams.get("omit"));

  // No last-text backfill here: it parsed up to 200 logs.json files
  // synchronously on the first GET of each project, on the one shared
  // connection. It runs once at boot (`instrumentation.ts`).

  if (streamParam !== null && !isSessionStreamType(streamParam)) {
    return NextResponse.json(
      {
        error: `Unknown stream "${streamParam}". Expected one of: ${SESSION_STREAM_TYPES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // Every branch is scoped by the (project, session) PAIR. 404 rather than
  // 403 on a mismatch: a caller with the wrong project has no business
  // learning the id exists.
  if (isSessionStreamType(streamParam)) {
    const beforeParam = searchParams.get("before");
    const before = parseSequence(beforeParam);
    const after = parseSequence(searchParams.get("after"));
    // A `before` that is present but unreadable is a client bug, not "no
    // cursor": falling through to the forward branch would answer a caller
    // walking back with a HEAD page, in the other page shape.
    if (beforeParam !== null && before === null) {
      return NextResponse.json(
        { error: "`before` must be a non-negative sequence number." },
        { status: 400 }
      );
    }
    if (before !== null && after !== null) {
      return NextResponse.json(
        { error: "`after` and `before` are exclusive: page forward or backward, not both." },
        { status: 400 }
      );
    }
    if (!sessionExistsInProject(projectId, sessionId)) return notFound();

    // `?before=`: the page just before a cursor, for the LIVE LOG walking
    // back from the end it opened on. Same byte budget as a forward page.
    if (before !== null) {
      const { tail, unavailable } = readChunkTail(sessionId, streamParam, {
        before,
        beforeOffset: parseOffset(searchParams.get("beforeOffset")),
        limit: parseLimit(searchParams.get("limit")),
        maxBytes: SESSION_CHUNK_PAGE_MAX_BYTES,
      });
      return NextResponse.json({
        data: {
          sessionId,
          ...tail,
          ...(unavailable ? { chunkStreamsUnavailable: true } : {}),
        },
      });
    }

    const { page, unavailable } = readChunkPage(sessionId, streamParam, {
      after,
      afterOffset: parseOffset(searchParams.get("offset")),
      limit: parseLimit(searchParams.get("limit")),
      maxBytes: SESSION_CHUNK_PAGE_MAX_BYTES,
    });

    return NextResponse.json({
      data: {
        sessionId,
        ...page,
        ...(unavailable ? { chunkStreamsUnavailable: true } : {}),
      },
    });
  }

  // The Arij-actions list, including the half that only exists in the raw
  // stream. Its own request, and its own bounded page of that stream: the
  // combined payload below is polled every 3 seconds, and the largest raw
  // stream on the live database is 3,015 rows / 113.6 MB. Scanning it there
  // stalled the shared connection on every poll even though the resulting
  // list was tiny.
  if (searchParams.get("view") === SESSION_ARIJ_ACTIONS_VIEW) {
    if (!sessionExistsInProject(projectId, sessionId)) return notFound();

    const { actions, hasMore, unavailable } = readArijActions(sessionId);
    return NextResponse.json({
      data: {
        sessionId,
        actions,
        hasMore,
        ...(unavailable ? { arijActionsUnavailable: true } : {}),
      },
    });
  }

  const detail = buildSessionDetail(projectId, sessionId, {
    prompt: include.has("prompt"),
    logs: include.has("logs"),
    // `?omit=streams`: the live page's polls, once its pagers are seeded.
    streams: !omit.has("streams"),
  });
  if (!detail) return notFound();

  return NextResponse.json({ data: detail });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
) {
  const { projectId, sessionId } = await params;

  // Cancelling is the destructive half of this route, so the project scope
  // matters more here than on GET: without it, knowing an id is enough to kill
  // a run belonging to another project.
  const session = db
    .select()
    .from(agentSessions)
    .where(
      and(eq(agentSessions.id, sessionId), eq(agentSessions.projectId, projectId))
    )
    .get();

  if (!session) {
    // Ephemeral activities (chat, spec generation) have no
    // agent_sessions row — the registry is their only record, and it carries
    // the same project scope.
    if (activityRegistry.cancelInProject(sessionId, projectId)) {
      return NextResponse.json({ data: { cancelled: true } });
    }
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Drop a not-yet-started launch from the scheduler queue (no-op when the
  // session already started), then cancel any live process.
  agentScheduler.remove(sessionId);
  processManager.cancel(sessionId);
  const now = new Date().toISOString();

  try {
    markSessionCancelled(sessionId, "Cancelled by user", now);
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (isSessionLifecycleConflictError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 409 }
      );
    }
    throw error;
  }

  // A QA check owns a `qa_reports` row, and that row's ONLY writer is the tail
  // of the launch closure in the QA check route. Cancelling a check that is
  // still queued splices that closure out of the scheduler, so nothing throws
  // and nothing ever moves the report off `running` — the row is stranded until
  // a restart runs `reconcileStrandedQaReports()`. Writing it here settles it in
  // the request that cancelled it. A no-op for every other kind of session, and
  // for a check whose closure already finalized its report (compare-and-set on
  // `running`, see lib/qa/report-lifecycle.ts). Deliberately after the session
  // transition: a refused cancellation is not a cancelled check.
  cancelQaReportsForSession(sessionId, now);

  return NextResponse.json({ data: { cancelled: true } });
}
