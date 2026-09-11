/**
 * Bounded, resumable scan of a session's raw chunk stream for
 * `mcp__arij__*` tool calls.
 *
 * The durable half of the Arij-actions list is three indexed reads
 * (`collectDurableArijActions`). The other half — read-only calls like
 * `get_ticket`, and effectful calls that left no artifact because the board
 * refused them — only exists in the provider's raw output, and finding it
 * used to mean `listSessionChunks(sessionId, "raw")`: one unbounded SELECT.
 * On the live database the largest raw stream is 3,015 rows / 113.6 MB, and
 * replaying just that SELECT takes 276–287 ms before any JSON parsing. That
 * ran on the session detail request, which the detail page polls every three
 * seconds, on the one shared synchronous better-sqlite3 connection — so it
 * stalled every other request, the SSE heartbeats and the Full Auto sweep,
 * however small the response itself was.
 *
 * This module makes the scan pay-as-you-go:
 *
 *   - one call reads at most `ARIJ_ACTION_SCAN_MAX_BYTES` of the stream,
 *     through the same bounded page reader the output tabs use;
 *   - where it stopped, and the partially-parsed line it stopped inside, are
 *     kept in a small process-local cache, so the next call resumes instead
 *     of starting over;
 *   - a live session therefore only ever scans what it appended since the
 *     last poll, and a terminal session is scanned once per process.
 *
 * The cache is a cache: losing it (restart, eviction) costs a rescan, never
 * correctness. Nothing durable depends on it.
 *
 * Since #236 the scan is the FALLBACK. The same scanner runs in the write
 * path (`startArijToolCallIndex`, fed by process-manager's onChunk) and
 * persists each call it completes, so a session indexed from its first raw
 * chunk is answered by one indexed read (`readIndexedArijToolCalls`) and its
 * raw stream is never walked for this list again. Only sessions written
 * before the index — or whose indexing failed and was given back — are
 * scanned as below, and only ONCE: a scan that reaches the end of a finished
 * session persists what it found and marks the session indexed
 * (`persistCompletedScan`), so the historical sessions that motivated #236
 * stop costing a full-stream walk per process after their first open.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessionChunks,
  agentSessions,
  agentSessionToolCallIndex,
  agentSessionToolCalls,
} from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import {
  createArijToolCallScanner,
  type ArijToolCall,
  type ArijToolCallRecord,
  type ArijToolCallScanner,
} from "./arij-actions";
import { listSessionChunkPage } from "./chunks";
import { TERMINAL_STATUSES } from "./lifecycle-status";

/**
 * Bytes of raw stream one call may read. Small enough that the synchronous
 * read plus its JSON parsing stays a few tens of milliseconds; large enough
 * that an ordinary session finishes in one call.
 */
export const ARIJ_ACTION_SCAN_MAX_BYTES = 2 * 1024 * 1024;

/** Chunk rows one call may read, whichever bound is reached first. */
export const ARIJ_ACTION_SCAN_MAX_CHUNKS = 500;

/**
 * Sessions kept mid-scan. Only the ones being looked at right now matter, and
 * each entry holds a handful of tool calls plus at most
 * `ARIJ_SCAN_MAX_PENDING_CHARS` of carry.
 */
const ARIJ_ACTION_SCAN_CACHE_SIZE = 16;

interface ScanState {
  scanner: ArijToolCallScanner;
  /** Chunk sequence the next page resumes after. */
  after: number | null;
  /** Characters of the chunk at `after` already fed to the scanner. */
  offset: number;
}

/** Insertion-ordered, so the first key is the least recently used. */
const scans = new Map<string, ScanState>();

export interface ArijToolCallScanResult {
  /** Every call found so far — a prefix of the stream's calls, in order. */
  toolCalls: ArijToolCall[];
  /** True when the stream has more to scan; call again to continue. */
  hasMore: boolean;
}

function stateFor(sessionId: string): ScanState {
  const existing = scans.get(sessionId);
  if (existing) {
    // Re-insert to mark it most recently used.
    scans.delete(sessionId);
    scans.set(sessionId, existing);
    return existing;
  }

  while (scans.size >= ARIJ_ACTION_SCAN_CACHE_SIZE) {
    const oldest = scans.keys().next().value;
    if (oldest === undefined) break;
    scans.delete(oldest);
  }

  const created: ScanState = {
    scanner: createArijToolCallScanner(),
    after: null,
    offset: 0,
  };
  scans.set(sessionId, created);
  return created;
}

/**
 * Advance the scan of one session by one bounded page and return everything
 * found so far. Synchronous, like every other read on this connection — the
 * point is that it is bounded, not that it yields.
 */
export function scanArijToolCalls(
  sessionId: string,
  options: { maxBytes?: number; limit?: number } = {}
): ArijToolCallScanResult {
  // An indexed session is complete in the index: no page, no cursor, and no
  // cached scan to keep for it.
  const indexed = readIndexedArijToolCalls(sessionId);
  if (indexed) {
    scans.delete(sessionId);
    return { toolCalls: indexed, hasMore: false };
  }

  const state = stateFor(sessionId);

  const page = listSessionChunkPage(sessionId, "raw", {
    after: state.after,
    afterOffset: state.offset,
    limit: options.limit ?? ARIJ_ACTION_SCAN_MAX_CHUNKS,
    maxBytes: options.maxBytes ?? ARIJ_ACTION_SCAN_MAX_BYTES,
  });

  for (const chunk of page.chunks) {
    state.scanner.push(chunk.content, chunk.createdAt);
  }
  // An empty page leaves the cursor where it was, so a live session that has
  // not written since simply asks again from the same place.
  state.after = page.nextAfter;
  state.offset = page.nextOffset;

  if (!page.hasMore && persistCompletedScan(sessionId, state.scanner)) {
    // The index now answers for this session; the cached scan is dead weight.
    scans.delete(sessionId);
    return { toolCalls: readIndexedArijToolCalls(sessionId) ?? [], hasMore: false };
  }

  return { toolCalls: state.scanner.snapshot(), hasMore: page.hasMore };
}

/**
 * A scan that has just reached the end of a session's raw stream: when the
 * session is finished, write what it found to the index and mark the session
 * indexed, so no later request — in this process or the next — walks that
 * stream again. Returns true when the index now answers for the session.
 *
 * Only safe because every cached scan started at the head of the stream
 * (`stateFor` creates them at `after: null`, and nothing moves a cursor
 * backwards or forwards except a page), so the scanner has seen every chunk
 * that survives. And only for a finished session with no run of it live in
 * this process: more raw output could still come otherwise, and nothing
 * would index it. The row's status alone does not say that — a dispatcher
 * may spawn a resume before it flips a completed row back to running — hence
 * the in-process registry of runs (`liveRuns`), which every spawn joins.
 *
 * Best-effort: a failure leaves the session to the scan, as before.
 */
function persistCompletedScan(sessionId: string, scanner: ArijToolCallScanner): boolean {
  if (liveRuns.has(sessionId)) return false;
  try {
    const row = db
      .select({ status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    if (!row?.status || !TERMINAL_STATUSES.has(row.status)) return false;

    // End of a finished stream: its unterminated last line is complete.
    scanner.flush();
    const calls = scanner.committed();
    db.transaction((tx) => {
      const claimed = tx
        .insert(agentSessionToolCallIndex)
        .values({ sessionId })
        .onConflictDoNothing()
        .run();
      // Already indexed by someone else: their rows stand, adding ours would
      // double every call.
      if (claimed.changes === 0) return;
      insertCalls(tx, sessionId, 0, calls);
    });
    return true;
  } catch (error) {
    console.warn(
      `[arij-actions] could not persist the scanned Arij tool calls of session ${sessionId}:`,
      error instanceof Error ? error.message : error
    );
    // The scanner was flushed: a later page must not resume from it.
    scans.delete(sessionId);
    return false;
  }
}

/** Drop all cached scans. Tests use it; nothing in the app needs to. */
export function resetArijToolCallScans(): void {
  scans.clear();
}

// ---------------------------------------------------------------------------
// Write-path index (#236)
// ---------------------------------------------------------------------------

/**
 * The calls persisted for an indexed session, in the order they were made —
 * or null when the session is not indexed and must be scanned instead.
 *
 * Two primary-key/unique-index lookups; the rows are a tool name and a
 * timestamp each, one per Arij call the session made.
 */
export function readIndexedArijToolCalls(sessionId: string): ArijToolCall[] | null {
  const marker = db
    .select({ sessionId: agentSessionToolCallIndex.sessionId })
    .from(agentSessionToolCallIndex)
    .where(eq(agentSessionToolCallIndex.sessionId, sessionId))
    .get();
  if (!marker) return null;

  return db
    .select({ tool: agentSessionToolCalls.tool, at: agentSessionToolCalls.at })
    .from(agentSessionToolCalls)
    .where(eq(agentSessionToolCalls.sessionId, sessionId))
    .orderBy(asc(agentSessionToolCalls.sequence))
    .all();
}

export interface ArijToolCallIndexer {
  /** Feed the next raw chunk, in stream order. Never throws. */
  push: (content: string, at: string | null) => void;
  /**
   * End of the run: commit the unterminated last line, and leave the live-run
   * registry. Must be called once per indexer. Never throws.
   */
  finish: () => void;
}

/**
 * Runs spawned in this process and not finished yet, per session — counted,
 * not flagged, since a re-dispatch can overlap the tail of the previous run.
 * The read side never persists a scan for a session in here.
 */
const liveRuns = new Map<string, number>();

function joinLiveRuns(sessionId: string): () => void {
  liveRuns.set(sessionId, (liveRuns.get(sessionId) ?? 0) + 1);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    const remaining = (liveRuns.get(sessionId) ?? 1) - 1;
    if (remaining > 0) liveRuns.set(sessionId, remaining);
    else liveRuns.delete(sessionId);
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert calls from `sequence` on. OR IGNORE on the (session, call id) index:
 * a call a resumed run replays is dropped, and its sequence number simply
 * stays unused — readers only need the order.
 */
function insertCalls(
  target: typeof db | Tx,
  sessionId: string,
  sequence: number,
  calls: ArijToolCallRecord[]
): void {
  if (calls.length === 0) return;
  target
    .insert(agentSessionToolCalls)
    .values(
      calls.map((call, i) => ({
        id: createId(),
        sessionId,
        sequence: sequence + i,
        tool: call.tool,
        at: call.at,
        callId: call.callId,
      }))
    )
    .onConflictDoNothing()
    .run();
}

/**
 * Give an indexing attempt up: drop the marker so readers go back to the
 * scan, which still sees whatever raw output survives. A marker left over a
 * partial index would serve a short list as a complete one.
 */
function abandonIndex(sessionId: string, error: unknown): void {
  console.warn(
    `[arij-actions] indexing Arij tool calls failed for session ${sessionId}; ` +
      "its list falls back to scanning the raw stream:",
    error instanceof Error ? error.message : error
  );
  try {
    db.transaction((tx) => {
      tx.delete(agentSessionToolCallIndex)
        .where(eq(agentSessionToolCallIndex.sessionId, sessionId))
        .run();
      tx.delete(agentSessionToolCalls)
        .where(eq(agentSessionToolCalls.sessionId, sessionId))
        .run();
    });
  } catch {
    // The database is what failed; nothing more can be done from here.
  }
}

/**
 * Start one run of a session: join the live-run registry and index the run
 * when it can produce a complete index —
 *
 *   - already indexed (a resumed run): continue after its last call;
 *   - no raw output yet: claim it — the index will have seen every chunk;
 *   - raw output from before the index: do not index. Claiming it would hide
 *     the older calls; the read-side scan covers them and persists the whole
 *     stream once the session is finished and this run has left.
 *
 * Always returns an indexer — one that only tracks liveness when the run is
 * not indexed — and its `finish()` must be called when the process is gone.
 *
 * Best-effort and cheap by construction: a raw chunk costs one substring test
 * per line (see ARIJ_CALL_HINT), a JSON parse only for a line that names an
 * Arij tool, and an INSERT only when a call completes. Any failure gives the
 * session back to the scan rather than blocking or failing the run.
 */
export function startArijToolCallIndex(sessionId: string): ArijToolCallIndexer {
  const leave = joinLiveRuns(sessionId);
  const untracked: ArijToolCallIndexer = { push() {}, finish: leave };

  let nextSequence: number;
  try {
    const marker = db
      .select({ sessionId: agentSessionToolCallIndex.sessionId })
      .from(agentSessionToolCallIndex)
      .where(eq(agentSessionToolCallIndex.sessionId, sessionId))
      .get();

    if (marker) {
      const last = db
        .select({ max: sql<number | null>`max(${agentSessionToolCalls.sequence})` })
        .from(agentSessionToolCalls)
        .where(eq(agentSessionToolCalls.sessionId, sessionId))
        .get();
      nextSequence = (last?.max ?? -1) + 1;
    } else {
      // Served by the (session_id, stream_type, sequence) index: one probe.
      const earlierRaw = db
        .select({ id: agentSessionChunks.id })
        .from(agentSessionChunks)
        .where(
          and(
            eq(agentSessionChunks.sessionId, sessionId),
            eq(agentSessionChunks.streamType, "raw")
          )
        )
        .limit(1)
        .get();
      if (earlierRaw) return untracked;

      db.insert(agentSessionToolCallIndex)
        .values({ sessionId })
        .onConflictDoNothing()
        .run();
      nextSequence = 0;
    }
  } catch (error) {
    console.warn(
      `[arij-actions] cannot index Arij tool calls for session ${sessionId}:`,
      error instanceof Error ? error.message : error
    );
    return untracked;
  }

  const scanner = createArijToolCallScanner();
  let persisted = 0;
  let abandoned = false;

  const persistCommitted = () => {
    const fresh = scanner.committed(persisted);
    if (fresh.length === 0) return;
    insertCalls(db, sessionId, nextSequence, fresh);
    persisted += fresh.length;
    nextSequence += fresh.length;
  };

  const guarded = (step: () => void) => {
    if (abandoned) return;
    try {
      step();
    } catch (error) {
      abandoned = true;
      abandonIndex(sessionId, error);
    }
  };

  return {
    push(content, at) {
      guarded(() => {
        scanner.push(content, at);
        persistCommitted();
      });
    },
    finish() {
      guarded(() => {
        scanner.flush();
        persistCommitted();
      });
      leave();
    },
  };
}
