/**
 * Server-side reads behind `GET /api/projects/:projectId/sessions/:sessionId`.
 *
 * SERVER-ONLY: this module reads `@/lib/db` and the filesystem. The client
 * half of the contract — bounds, response types, fetchers — is
 * `lib/agent-sessions/session-detail.ts`, which client components import; do
 * not import this file from there or from a component.
 *
 * Lifted out of the route so the route is a thin I/O layer (parse the query,
 * pick a reader, serialise) and so every reader here is testable, and
 * reusable, without a request.
 */
import fs from "fs";
import { and, eq, getTableColumns } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentSessions, namedAgents } from "@/lib/db/schema";
import {
  extractLastNonEmptyTextFromFile,
  extractLastNonEmptyTextFromLogs,
} from "@/lib/agent-sessions/last-text";
import {
  listSessionChunkPage,
  listSessionChunkTail,
  truncateUtf8,
  type AgentSessionStreamType,
  type SessionChunkPage,
  type SessionChunkTail,
} from "@/lib/agent-sessions/chunks";
import {
  SESSION_DETAIL_PREVIEW_BYTES,
  SESSION_DETAIL_PREVIEW_LIMIT,
  SESSION_LAST_TEXT_MAX_BYTES,
  SESSION_LOGS_MAX_FILE_BYTES,
  SESSION_LOGS_MAX_RESULT_BYTES,
  SESSION_LOGS_MAX_SERVED_BYTES,
  type SessionStreamTailSeed,
} from "@/lib/agent-sessions/session-detail";
import {
  collectDurableArijActions,
  mergeArijActions,
  type ArijAction,
} from "@/lib/agent-sessions/arij-actions";
import { scanArijToolCalls } from "@/lib/agent-sessions/arij-action-scan";
import { getSessionStatusForApi } from "@/lib/agent-sessions/lifecycle";
import { resolveCliSessionId } from "@/lib/db/resolve-cli-session-id";

/**
 * Every column except `prompt`. On the live database the prompt is up to 1.8
 * MB of a single response and the detail page only shows it when the user
 * opens the Prompt tab, so it is served on `?include=prompt` and nowhere
 * else. Derived from the table rather than hand-listed: a column added to the
 * schema keeps appearing here, and only `prompt` is a deliberate omission.
 */
const { prompt: promptColumn, ...sessionColumnsWithoutPrompt } =
  getTableColumns(agentSessions);

const sessionColumnsWithPrompt = {
  ...sessionColumnsWithoutPrompt,
  prompt: promptColumn,
};

type SessionLogs = Record<string, unknown> & { result?: unknown };

export interface SessionLogsRead {
  logs: unknown;
  /** The file was too large to parse, or its content was cut down to a cap. */
  truncated: boolean;
  /** The file exists but could not be read or parsed. */
  unavailable: boolean;
  /**
   * The parsed document, when there is one — so the caller can derive from it
   * instead of reading the same file again.
   */
  parsed?: unknown;
}

/**
 * Read `logs.json` under a byte bound. The file is a sibling of the chunk
 * streams — the same output, written once more at the end of the run — and
 * the largest on the live database is 14.8 MB, nearly all of it `result`.
 */
export function readSessionLogs(logsPath: string | null): SessionLogsRead {
  if (!logsPath || !fs.existsSync(logsPath)) {
    return { logs: null, truncated: false, unavailable: false };
  }

  try {
    const size = fs.statSync(logsPath).size;
    if (size > SESSION_LOGS_MAX_FILE_BYTES) {
      // Not parsed at all: JSON.parse of a multi-megabyte document blocks the
      // event loop for every other caller. The same text is in the `response`
      // stream, which pages.
      return { logs: null, truncated: true, unavailable: false };
    }

    const parsed = JSON.parse(fs.readFileSync(logsPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { logs: null, truncated: false, unavailable: false, parsed };
    }

    let logs: unknown = parsed;
    let truncated = false;

    // `result` is where the size is: for the 8.6 MB log measured when this
    // cap landed it was 8,295,860 of the 8,600,000 bytes.
    if (!Array.isArray(parsed) && typeof (parsed as SessionLogs).result === "string") {
      const full = (parsed as SessionLogs).result as string;
      const capped = truncateUtf8(full, SESSION_LOGS_MAX_RESULT_BYTES);
      if (capped.truncated) {
        const total = Buffer.byteLength(full, "utf-8");
        // The marker rides inside the string so it survives everywhere the
        // result is shown OR exported, not just where a flag is read.
        logs = {
          ...(parsed as SessionLogs),
          result: `${capped.text}\n\n[Arij: output truncated — showing ${SESSION_LOGS_MAX_RESULT_BYTES} of ${total} bytes. The rest is in the Raw Logs stream below, which pages.]`,
        };
        truncated = true;
      }
    }

    // Shape-agnostic backstop. Capping `result` bounds the documents Arij
    // writes today; it does nothing for a legacy array-shaped log, or one
    // whose bulk sits in some other field. Serving nothing beats reopening
    // the hole this route exists to close — the streams still have the text.
    //
    // Measured in BYTES. A JS string's `.length` is UTF-16 code units, and
    // the cap is a byte ceiling on a JSON response: a CJK- or emoji-heavy log
    // encodes to up to ~3-4x its unit count, so counting units would let a
    // document several times over the limit through this check.
    if (
      Buffer.byteLength(JSON.stringify(logs), "utf8") >
      SESSION_LOGS_MAX_SERVED_BYTES
    ) {
      return { logs: null, truncated: true, unavailable: false, parsed };
    }

    return { logs, truncated, unavailable: false, parsed };
  } catch (error) {
    console.warn(
      `[sessions] failed to read logs for session at ${logsPath}:`,
      error
    );
    return { logs: null, truncated: false, unavailable: true };
  }
}

/** One-line preview, so it is served as one — never as a whole stream. */
export function capLastNonEmptyText(text: string | null): string | null {
  if (!text) return null;
  const capped = truncateUtf8(text, SESSION_LAST_TEXT_MAX_BYTES);
  return capped.truncated ? `${capped.text}…` : capped.text;
}

/**
 * One forward stream page, or an explicit unavailable marker. A chunk read
 * that fails used to collapse to `null` alongside a session that simply
 * produced no output — indistinguishable to the client, and silent in the log.
 */
export function readChunkPage(
  sessionId: string,
  streamType: AgentSessionStreamType,
  options: {
    after?: number | null;
    afterOffset?: number;
    limit?: number;
    maxBytes: number;
  }
): { page: SessionChunkPage; unavailable: boolean } {
  try {
    return {
      page: listSessionChunkPage(sessionId, streamType, options),
      unavailable: false,
    };
  } catch (error) {
    console.warn(
      `[sessions] failed to read the ${streamType} stream of session ${sessionId}:`,
      error
    );
    return {
      page: {
        streamType,
        chunks: [],
        nextAfter: options.after ?? null,
        nextOffset: options.afterOffset ?? 0,
        hasMore: false,
      },
      unavailable: true,
    };
  }
}

/**
 * The end of a stream — or, with `before`, the page just before a cursor —
 * with the same explicit unavailable marker. On a failure the cursor comes
 * back as it was asked, so a client walking towards the head retries from
 * where it stood instead of concluding it reached the start.
 */
export function readChunkTail(
  sessionId: string,
  streamType: AgentSessionStreamType,
  options: {
    before?: number | null;
    beforeOffset?: number;
    limit?: number;
    maxBytes: number;
  }
): { tail: SessionChunkTail; unavailable: boolean } {
  try {
    return {
      tail: listSessionChunkTail(sessionId, streamType, options),
      unavailable: false,
    };
  } catch (error) {
    console.warn(
      `[sessions] failed to read the ${streamType} stream of session ${sessionId}:`,
      error
    );
    const before = options.before ?? null;
    return {
      tail: {
        streamType,
        chunks: [],
        firstSequence: before,
        firstOffset: before === null ? 0 : (options.beforeOffset ?? 0),
        lastSequence: null,
        hasEarlier: before !== null,
      },
      unavailable: true,
    };
  }
}

/**
 * A tail as a stream seed: it carries the backward cursor for "load earlier",
 * and the forward one (`nextAfter = lastSequence`) a running session follows.
 */
export function toTailSeed(
  tail: SessionChunkTail
): SessionStreamTailSeed & { streamType: AgentSessionStreamType } {
  return {
    streamType: tail.streamType,
    chunks: tail.chunks,
    nextAfter: tail.lastSequence,
    nextOffset: 0,
    hasMore: false,
    firstSequence: tail.firstSequence,
    firstOffset: tail.firstOffset,
    lastSequence: tail.lastSequence,
    hasEarlier: tail.hasEarlier,
  };
}

/**
 * Durable actions plus the chunk-derived tool calls, merged. For a session
 * indexed at write time those calls are one indexed read and `hasMore` is
 * false; for an older session they are one bounded page of the raw-stream
 * scan, which resumes where the previous call for this session stopped.
 */
export function readArijActions(sessionId: string): {
  actions: ArijAction[];
  hasMore: boolean;
  unavailable: boolean;
} {
  let actions: ArijAction[] = [];
  try {
    actions = collectDurableArijActions({ sessionId });
  } catch (error) {
    console.warn(
      `[sessions] failed to collect Arij actions for session ${sessionId}:`,
      error
    );
    return { actions: [], hasMore: false, unavailable: true };
  }

  try {
    const scan = scanArijToolCalls(sessionId);
    return {
      actions: mergeArijActions(actions, scan.toolCalls),
      hasMore: scan.hasMore,
      unavailable: false,
    };
  } catch (error) {
    console.warn(
      `[sessions] failed to scan the raw stream of session ${sessionId} for Arij actions:`,
      error
    );
    // The durable half still stands on its own — flagged, not silently short.
    return { actions, hasMore: false, unavailable: true };
  }
}

/**
 * Scoped by the PAIR, not by id alone. The URL says which project this
 * session belongs to, and `agent_sessions.project_id` is NOT NULL, so a
 * mismatch is never ambiguous — it is a session from somewhere else, and its
 * prompt, logs and raw output are not this project's to hand over.
 */
function sessionScope(projectId: string, sessionId: string) {
  return and(
    eq(agentSessions.id, sessionId),
    eq(agentSessions.projectId, projectId)
  );
}

/**
 * The scope check alone: one indexed read by id, however large the session
 * grew. What a stream page and the actions view need — none of the row.
 */
export function sessionExistsInProject(
  projectId: string,
  sessionId: string
): boolean {
  return Boolean(
    db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(sessionScope(projectId, sessionId))
      .get()
  );
}

export interface SessionDetailIncludes {
  /** `?include=prompt` — the stored prompt, up to 1.8 MB on the live database. */
  prompt?: boolean;
  /** `?include=logs` — `logs.json`, parsed under its caps. */
  logs?: boolean;
  /**
   * The three stream previews (`chunkStreams`). On by default; `?omit=streams`
   * turns them off. The live page only seeds its pagers from them on the
   * FIRST read — the pagers are keyed on the stream's identity and ignore
   * every later seed — so a 3-second poll that re-read the raw tail and both
   * heads (up to 3 × 64 KiB, a couple of dozen statements) paid for bytes the
   * client dropped on the floor.
   */
  streams?: boolean;
}

type SessionRowWithoutPrompt = Omit<typeof agentSessions.$inferSelect, "prompt">;

/** What `buildSessionDetail` serialises. `prompt` only when it was asked for. */
export type SessionDetailPayload = Omit<
  SessionRowWithoutPrompt,
  "status" | "cliSessionId" | "lastNonEmptyText"
> & {
  status: ReturnType<typeof getSessionStatusForApi>;
  cliSessionId: string | null;
  lastNonEmptyText: string | null;
  logs?: unknown;
  logsTruncated?: boolean;
  logsUnavailable?: true;
  chunkStreams?: {
    raw: SessionStreamTailSeed;
    output: SessionChunkPage;
    response: SessionChunkPage;
  };
  chunkStreamsUnavailable?: true;
  compositeAgentName: string | null;
  arijActions: ArijAction[];
  arijActionsUnavailable?: true;
};

/**
 * The combined detail payload, or null when the session is not in this
 * project. This is what the live page polls every 3 seconds while a session
 * runs, so everything in it is bounded and nothing in it reads a file unless
 * asked to.
 */
export function buildSessionDetail(
  projectId: string,
  sessionId: string,
  include: SessionDetailIncludes & { prompt: true }
): (SessionDetailPayload & { prompt: string | null }) | null;
export function buildSessionDetail(
  projectId: string,
  sessionId: string,
  include?: SessionDetailIncludes
): SessionDetailPayload | null;
export function buildSessionDetail(
  projectId: string,
  sessionId: string,
  include: SessionDetailIncludes = {}
): SessionDetailPayload | null {
  const session = db
    .select(include.prompt ? sessionColumnsWithPrompt : sessionColumnsWithoutPrompt)
    .from(agentSessions)
    .where(sessionScope(projectId, sessionId))
    .get();
  if (!session) return null;

  // The composite that DISPATCHED this run, when one did. `namedAgentId` on
  // the row is the member that actually ran, so without this the detail page
  // cannot tell two runs apart whose resolved configuration differed only in
  // which list produced them. Read by id rather than joined so a deleted
  // composite (ON DELETE SET NULL) simply yields nothing.
  const compositeAgentName = session.compositeAgentId
    ? (db
        .select({ name: namedAgents.name })
        .from(namedAgents)
        .where(eq(namedAgents.id, session.compositeAgentId))
        .get()?.name ?? null)
    : null;

  // A preview of each stream, so the page paints without a second round
  // trip — and so no client pays for 112 MB. `output` and `response` are
  // final results written once, so their HEAD is the preview; `raw` is the
  // running log, and what the LIVE LOG wants of it is the END.
  let chunkStreamsUnavailable = false;
  let chunkStreams: SessionDetailPayload["chunkStreams"];
  if (include.streams !== false) {
    const raw = readChunkTail(sessionId, "raw", {
      limit: SESSION_DETAIL_PREVIEW_LIMIT,
      maxBytes: SESSION_DETAIL_PREVIEW_BYTES,
    });
    chunkStreamsUnavailable = raw.unavailable;
    const heads = (["output", "response"] as const).map((streamType) => {
      const { page, unavailable } = readChunkPage(sessionId, streamType, {
        limit: SESSION_DETAIL_PREVIEW_LIMIT,
        maxBytes: SESSION_DETAIL_PREVIEW_BYTES,
      });
      chunkStreamsUnavailable = chunkStreamsUnavailable || unavailable;
      return page;
    });
    chunkStreams = {
      raw: toTailSeed(raw.tail),
      output: heads[0],
      response: heads[1],
    };
  }

  // Structured board effects of this session — the DURABLE half only: three
  // indexed, session-scoped reads. The chunk-derived supplement is served by
  // `?view=arij-actions`, which the detail page follows after its first
  // paint. Best-effort either way: the page must not 500 over an activity
  // list.
  let arijActions: ArijAction[] = [];
  let arijActionsUnavailable = false;
  try {
    arijActions = collectDurableArijActions({ sessionId });
  } catch (error) {
    console.warn(
      `[sessions] failed to collect Arij actions for session ${sessionId}:`,
      error
    );
    arijActions = [];
    arijActionsUnavailable = true;
  }

  // `logs.json` only on request. The final text it duplicates is the
  // `response` stream (previewed above) and `last_non_empty_text` (on the
  // row), so the 3-second poll never opens, stats or parses it.
  const logsRead = include.logs ? readSessionLogs(session.logsPath) : null;

  // The stored column is the one source on the polled payload. When the logs
  // were asked for anyway, a legacy array-shaped document still gets to
  // supply it, as it did when the route always read the file.
  const extractedFromLogs = !logsRead
    ? null
    : logsRead.parsed !== undefined
      ? extractLastNonEmptyTextFromLogs(logsRead.parsed)
      : logsRead.unavailable
        ? extractLastNonEmptyTextFromFile(session.logsPath)
        : null;
  const lastNonEmptyText = capLastNonEmptyText(
    extractedFromLogs || session.lastNonEmptyText || null
  );

  return {
    ...session,
    status: getSessionStatusForApi(session.status),
    // Legacy-row fallback handled inside resolveCliSessionId().
    cliSessionId: resolveCliSessionId(session),
    // Explicit rather than inferred: "no logs" and "logs too large to serve
    // here" and "the logs file is unreadable" are three different states.
    ...(logsRead
      ? {
          logs: logsRead.logs,
          logsTruncated: logsRead.truncated,
          ...(logsRead.unavailable ? { logsUnavailable: true as const } : {}),
        }
      : {}),
    ...(chunkStreams ? { chunkStreams } : {}),
    ...(chunkStreamsUnavailable ? { chunkStreamsUnavailable: true as const } : {}),
    lastNonEmptyText,
    compositeAgentName,
    arijActions,
    ...(arijActionsUnavailable ? { arijActionsUnavailable: true as const } : {}),
  };
}
