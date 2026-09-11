import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createId } from "@/lib/utils/nanoid";
import { sqlite } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  agentSessionChunks,
  agentSessionSequences,
  agentSessions,
} from "@/lib/db/schema";
import { extractLastNonEmptyText } from "@/lib/agent-sessions/last-text";
import {
  chunkElisionMarker,
  rawStreamTrimMarker,
  SESSION_CHUNK_MAX_STORED_BYTES,
  SESSION_CHUNK_STORED_HEAD_BYTES,
  SESSION_CHUNK_STORED_TAIL_BYTES,
  SESSION_RAW_STREAM_KEPT_HEAD_CHUNKS,
  SESSION_RAW_STREAM_MAX_BYTES,
  SESSION_RAW_STREAM_TRIM_CHUNK_KEY,
  SESSION_RAW_STREAM_TRIM_TO_RATIO,
} from "@/lib/agent-sessions/chunk-cap";
import { capTextHeadTail } from "@/lib/agent-sessions/head-tail-cap";
// Type-only in the other direction, so this is not a runtime cycle.
import { countCharacters } from "@/lib/agent-sessions/session-detail";

export type AgentSessionStreamType = "response" | "raw" | "output";

export interface SessionChunk {
  id: string;
  sessionId: string;
  streamType: AgentSessionStreamType;
  sequence: number;
  chunkKey: string | null;
  content: string;
  createdAt: string | null;
}

/**
 * Page size when a caller does not ask for one. Chunks average ~5.5 KB on the
 * live database, so this is a few hundred KB of content, not tens of MB.
 */
export const SESSION_CHUNK_PAGE_DEFAULT_LIMIT = 200;

/**
 * Byte budget for one page's content. A row limit alone does not bound a
 * page: chunks are capped at 64 KiB by most producers, but the store has
 * accepted single chunks of 8.3 MB (one CLI result blob written as one
 * chunk), so `limit` rows can still be tens of MB.
 */
export const SESSION_CHUNK_PAGE_MAX_BYTES = 1024 * 1024;

/**
 * Per-chunk content cap. A chunk larger than this is split across pages: the
 * page stops inside it and the cursor carries how much of it was delivered,
 * so the whole chunk is still reachable. The live database holds 19 chunks
 * over 1 MB and one of 8.3 MB — a one-shot CLI result blob written as a
 * single chunk — and no row-count bound can bound those.
 *
 * Rows written since {@link SESSION_CHUNK_MAX_STORED_BYTES} landed cannot
 * exceed it, so for those the split never triggers. The oversized rows above
 * are the ones already in the database, and this stays the bound on them.
 */
export const SESSION_CHUNK_MAX_CONTENT_BYTES = 256 * 1024;

/**
 * Hard ceiling on how many rows one underlying query may materialise. The
 * page is assembled batch by batch so that `limit` — which a client picks —
 * never multiplies with the per-chunk cap into one huge read.
 *
 * This is only the ceiling; `batchRows()` below usually asks for far less.
 */
const CHUNK_PAGE_BATCH_ROWS = 64;

/**
 * Rows to ask SQLite for, given what is left of the page's byte budget.
 *
 * The row ceiling alone does not bound the read: every row comes back as
 * `substr(content, 1, maxChunkBytes)`, so a full 64-row batch at the 256 KiB
 * per-chunk cap is ~16 M characters materialised inside the driver — up to
 * ~64 MB of UTF-8 — before JavaScript gets to refuse the rows past the
 * budget. The response would still be bounded; the event loop would not be,
 * and blocking it is the whole reason this page exists.
 *
 * Sizing the batch from the REMAINING budget makes the worst case one batch
 * of about `maxBytes` characters instead. The cost is round trips: at the
 * default budget this asks for 4 rows at a time, so an average stream (~5.5 KB
 * per chunk) needs a few dozen small queries to fill a full page rather than
 * four large ones. Each is an indexed lookup on a prepared statement, and
 * copying the page's content dominates either way.
 */
function batchRows(remainingBytes: number, maxChunkBytes: number): number {
  return Math.max(1, Math.ceil(remainingBytes / maxChunkBytes));
}

/** A chunk, or a slice of one, as a bounded page serves it. */
export interface BoundedSessionChunk extends SessionChunk {
  /**
   * Character length of the STORED chunk (SQLite `length()`), before any cap,
   * so a client rendering a slice can say how much of it it is holding.
   */
  contentLength: number;
  /** True when `content` is only part of the stored chunk. */
  contentTruncated: boolean;
  /** Character offset of `content` within the stored chunk. */
  contentOffset: number;
}

export interface SessionChunkPageOptions {
  /** Exclusive lower bound on `sequence`. Omit or null for the first page. */
  after?: number | null;
  /**
   * Characters of the chunk AT `after` already delivered. Non-zero only when
   * the previous page stopped inside an oversized chunk; the page then
   * resumes from that offset before moving on to later chunks.
   */
  afterOffset?: number | null;
  /** Maximum number of chunks in the page. */
  limit?: number;
  /** Byte budget for the page's total content. */
  maxBytes?: number;
  /** Byte cap applied to each individual chunk's content. */
  maxChunkBytes?: number;
}

export interface SessionChunkPage {
  streamType: AgentSessionStreamType;
  chunks: BoundedSessionChunk[];
  /**
   * Cursor for the next request. The sequence of the last chunk in the page,
   * or the `after` the caller passed when the page came back empty — a live
   * session that has not written since simply yields the same cursor again.
   */
  nextAfter: number | null;
  /**
   * Second half of the cursor: characters of the chunk at `nextAfter` already
   * delivered, or 0 when that chunk was delivered whole. Echo both back.
   */
  nextOffset: number;
  /** True when more chunks — or more of the current one — remain. */
  hasMore: boolean;
}

/**
 * Cut `text` to at most `maxBytes` UTF-8 bytes without splitting a multi-byte
 * character. Measuring in UTF-16 units instead would under-count: one unit is
 * up to three UTF-8 bytes, so a CJK-heavy page would blow its budget 3x.
 */
export function truncateUtf8(
  text: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return { text, truncated: false };
  // Walk back off a continuation byte (0b10xxxxxx) so the slice ends on a
  // character boundary rather than decoding to U+FFFD.
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return { text: buffer.subarray(0, end).toString("utf8"), truncated: true };
}

/**
 * The mirror of {@link truncateUtf8}: keep the END of `text` within
 * `maxBytes` UTF-8 bytes, again without splitting a character. What a tail
 * reader wants from an oversized chunk — the most recent output, not its
 * first lines.
 */
export function truncateUtf8Tail(
  text: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return { text, truncated: false };
  // Step forward off continuation bytes so the slice starts on a lead byte.
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  return { text: buffer.subarray(start).toString("utf8"), truncated: true };
}

/**
 * Cut `content` down to {@link SESSION_CHUNK_MAX_STORED_BYTES}, keeping a head
 * and a tail with an explicit marker between them.
 *
 * This is the write-path cap — the change that stops the growth rather than
 * reclaiming it afterwards. `appendChunk` used to store whatever it was
 * handed at any size, which is how the live database came to hold a single
 * 8.3 MB chunk and a single 51.3 MB session.
 *
 * The cut itself is {@link capTextHeadTail}, shared with the prompt cap: the
 * two differ only in their numbers and their marker, and one copy of a UTF-8
 * boundary walk is enough. The common case — every chunk is ~5.5 KB on
 * average, and this runs once per emission on every live session — costs one
 * `byteLength` scan and no allocation at all.
 */
export function capChunkContent(content: string): {
  content: string;
  capped: boolean;
} {
  const cut = capTextHeadTail(content, {
    maxBytes: SESSION_CHUNK_MAX_STORED_BYTES,
    headBytes: SESSION_CHUNK_STORED_HEAD_BYTES,
    tailBytes: SESSION_CHUNK_STORED_TAIL_BYTES,
    marker: chunkElisionMarker,
  });
  return { content: cut.text, capped: cut.capped };
}

/**
 * Namespace for a chunk key Arij derives instead of receiving. Keeps a
 * derived key disjoint from every caller-supplied one: the live database's
 * 256,594 keys are all `stdout:N`, `stderr:N`, `final-output`,
 * `final-response` or `result-<sessionId>`, and none of those can start here.
 */
export const DERIVED_CHUNK_KEY_PREFIX = "sha256-";

/**
 * The key a keyless chunk is stored under: a digest of the content the writer
 * handed us, BEFORE the cap.
 *
 * Before the cap, and never after it, because the cap is lossy: it keeps a
 * head and a tail and drops the middle. Two different chunks of equal byte
 * length whose kept ends agree — a stream that repeats a long banner, an
 * agent writing two answers under the same preamble — cap to the same row and
 * would collide deterministically on a digest of the capped form. The second
 * one is not a duplicate; discarding it drops real output AND skips the
 * uncapped `lastNonEmptyText` extraction, so the session's final word stays
 * whatever the first chunk said. Hashing the original makes the digest mean
 * what its name says: same input, same key.
 *
 * Dedupe rides the existing (session_id, stream_type, chunk_key) unique index
 * rather than a new hash column, so a keyless write gets exactly the
 * duplicate semantics a keyed one already had, with no migration and no
 * second index to keep in step. SQLite treats NULLs in a unique index as
 * distinct from each other, which is precisely why keyless chunks never
 * deduped before.
 *
 * base64url rather than hex: the same 256 bits in 43 characters instead of
 * 64, on a column that is now written and indexed for every keyless chunk.
 *
 * Cost: one sha256 pass over the whole input rather than over the capped
 * 256 KiB. Only keyless writers pay it — every row on the live database
 * arrives with a provider key and takes the lookup-only fast path above —
 * and at ~5.5 KB per chunk it is far below the `Buffer` work the cap already
 * does on the same string.
 */
export function deriveChunkKey(content: string): string {
  return (
    DERIVED_CHUNK_KEY_PREFIX +
    createHash("sha256").update(content, "utf8").digest("base64url")
  );
}

export interface AppendSessionChunkInput {
  sessionId: string;
  streamType: AgentSessionStreamType;
  content: string;
  chunkKey?: string | null;
  createdAt?: string;
}

export interface AppendSessionChunkResult {
  inserted: boolean;
  chunk: SessionChunk;
}

export interface SessionChunkTailOptions {
  /** Maximum number of chunks in the tail. */
  limit?: number;
  /** Byte budget for the tail's total content. */
  maxBytes?: number;
  /**
   * Byte cap on each chunk's content. An oversized chunk is served as its
   * END; the cursor then points inside it (see `firstOffset`). Clamped to
   * `maxBytes`, like the forward page.
   */
  maxChunkBytes?: number;
  /**
   * Exclusive upper bound on `sequence`: the page ends just before it. Omit
   * or null for the end of the stream. Pass the previous page's
   * `firstSequence` to walk towards the head.
   */
  before?: number | null;
  /**
   * Characters at the HEAD of the chunk at `before` still undelivered — the
   * previous page's `firstOffset`. Non-zero only when that page served just
   * the end of an oversized chunk; the page then starts with the rest of it.
   */
  beforeOffset?: number | null;
}

export interface SessionChunkTail {
  streamType: AgentSessionStreamType;
  /** The most recent chunks (before the cursor), in ascending sequence order. */
  chunks: BoundedSessionChunk[];
  /** Sequence of the first chunk served, or null when the page is empty. */
  firstSequence: number | null;
  /**
   * Character offset, within the chunk at `firstSequence`, where the served
   * slice starts — 0 when that chunk went out whole from its head. Echo it
   * back as `beforeOffset` with `before: firstSequence`.
   */
  firstOffset: number;
  /** Sequence of the last chunk served — the `after` cursor for a live follow. */
  lastSequence: number | null;
  /** True when anything precedes the page: the head of its first chunk, or earlier rows. */
  hasEarlier: boolean;
}

/** Options of the write-path cap on a session's raw stream. */
export interface SessionRawStreamCapOptions {
  maxBytes?: number;
  keptHeadChunks?: number;
  trimToRatio?: number;
}

/** One batch of the walk that brings historical raw streams under the cap. */
export interface RawStreamsOverCapOptions {
  /** Resume strictly after this session id (the previous batch's `lastSessionId`). */
  afterSessionId?: string | null;
  /** Sessions examined by this call; omit to walk every remaining one. */
  maxSessions?: number;
  /**
   * Return right after this many sessions were trimmed. A trim deletes a
   * stream's bulk under the write lock, so a caller sharing the connection
   * with live requests asks for 1 and yields between calls.
   */
  maxTrimmedSessions?: number;
}

export interface RawStreamsOverCapResult {
  /** Sessions whose raw stream was weighed. */
  scannedSessions: number;
  /** Sessions that were over the cap and got trimmed. */
  trimmedSessions: number;
  /** Rows deleted by this call (the marker rows it wrote are not subtracted). */
  droppedChunks: number;
  /** Characters of content those rows held — the unit `length()` counts. */
  droppedBytes: number;
  /**
   * 1 when the database refused the write lock (busy/locked): the walk stops
   * there rather than paying one busy wait per remaining session.
   */
  lockedSessions: number;
  /**
   * Last session id fully handled — the next call's `afterSessionId`. A
   * refused session is not counted as handled, so resuming retries it.
   */
  lastSessionId: string | null;
  /** True when no session with a raw stream sorts after `lastSessionId`. */
  done: boolean;
}

export interface SessionChunkStore {
  appendChunk: (input: AppendSessionChunkInput) => AppendSessionChunkResult;
  listChunks: (
    sessionId: string,
    streamType: AgentSessionStreamType
  ) => SessionChunk[];
  /**
   * The END of a stream: the most recent chunks under a row and byte budget,
   * returned in ascending order. What the LIVE LOG of a finished session and
   * a live follow's seed want — `listChunkPage` only reads from the head.
   */
  listChunkTail: (
    sessionId: string,
    streamType: AgentSessionStreamType,
    options?: SessionChunkTailOptions
  ) => SessionChunkTail;
  /**
   * The last `maxChars` characters of a stream as one string, or null when
   * the stream is empty. Reads chunks from the end and stops as soon as the
   * budget is covered, so a 100 MB stream costs a few rows, not a full scan.
   */
  readTail: (
    sessionId: string,
    streamType: AgentSessionStreamType,
    maxChars: number
  ) => string | null;
  /**
   * Bounded variant of `listChunks`: one keyset page of a single stream,
   * ordered by sequence, capped by row count AND by bytes. Added alongside
   * `listChunks` rather than replacing it — the forensic collector and the
   * Arij-action scanner want the whole stream and are unaffected.
   */
  listChunkPage: (
    sessionId: string,
    streamType: AgentSessionStreamType,
    options?: SessionChunkPageOptions
  ) => SessionChunkPage;
  /**
   * Timestamp of the most recent chunk for a session across all stream
   * types, or null when the session has no chunks yet. Cheap (single
   * indexed MAX) — used by the silent-session watchdog and the active
   * sessions monitor to derive "last output" freshness.
   */
  lastChunkAt: (sessionId: string) => string | null;
  /**
   * Apply the write-path raw cap to streams written before it existed. The
   * cap only fires on an append, so a session that stopped writing before
   * the cap shipped keeps every byte it ever stored; this walks sessions in
   * id order and runs the same trim on any whose raw stream is over the cap.
   * One short IMMEDIATE transaction per session; a session the database
   * refuses (busy/locked) is counted and skipped, never retried in a loop.
   * Idempotent: a trimmed stream sits below the cap, so a second walk trims
   * nothing.
   */
  trimRawStreamsOverCap: (options?: RawStreamsOverCapOptions) => RawStreamsOverCapResult;
}

type ChunkRow = {
  id: string;
  sessionId: string;
  streamType: string;
  sequence: number;
  chunkKey: string | null;
  content: string;
  createdAt: string | null;
};

/**
 * `stream_type` is a plain text column in the schema; the store is the layer
 * that narrows it back to the union the rest of the app works with.
 */
function toSessionChunk(row: ChunkRow): SessionChunk {
  return {
    ...row,
    streamType: row.streamType as AgentSessionStreamType,
  };
}

export function createSessionChunkStore(
  database: Database.Database,
  rawCap: SessionRawStreamCapOptions = {}
): SessionChunkStore {
  const db = drizzle(database, { schema });

  const rawMaxBytes = Math.max(1, rawCap.maxBytes ?? SESSION_RAW_STREAM_MAX_BYTES);
  const rawKeptHeadChunks = Math.max(
    0,
    rawCap.keptHeadChunks ?? SESSION_RAW_STREAM_KEPT_HEAD_CHUNKS
  );
  const rawTrimTarget = Math.floor(
    rawMaxBytes * (rawCap.trimToRatio ?? SESSION_RAW_STREAM_TRIM_TO_RATIO)
  );

  /**
   * Raw bytes stored per session, process-local. Seeded from SQLite the first
   * time a session's raw stream is written to by this process, then kept in
   * step by the append and trim paths below, so the cap costs one `sum()` per
   * session lifetime rather than one per chunk.
   */
  const rawBytesBySession = new Map<string, number>();

  // Built here rather than at module scope so that importing this module
  // stays free of any schema/driver evaluation.
  const chunkColumns = {
    id: agentSessionChunks.id,
    sessionId: agentSessionChunks.sessionId,
    streamType: agentSessionChunks.streamType,
    sequence: agentSessionChunks.sequence,
    chunkKey: agentSessionChunks.chunkKey,
    content: agentSessionChunks.content,
    createdAt: agentSessionChunks.createdAt,
  };

  const selectExistingByKeyStmt = db
    .select(chunkColumns)
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        eq(agentSessionChunks.chunkKey, sql.placeholder("chunkKey"))
      )
    )
    .limit(1)
    .prepare();

  const reserveSequenceStmt = db
    .insert(agentSessionSequences)
    .values({
      sessionId: sql.placeholder("sessionId"),
      nextSequence: 2,
      updatedAt: sql.placeholder("updatedAt"),
    })
    .onConflictDoUpdate({
      target: agentSessionSequences.sessionId,
      set: {
        nextSequence: sql`${agentSessionSequences.nextSequence} + 1`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning({
      sequence: sql`next_sequence - 1`.mapWith(Number),
    })
    .prepare();

  const insertChunkStmt = db
    .insert(agentSessionChunks)
    .values({
      id: sql.placeholder("id"),
      sessionId: sql.placeholder("sessionId"),
      streamType: sql.placeholder("streamType"),
      sequence: sql.placeholder("sequence"),
      chunkKey: sql.placeholder("chunkKey"),
      content: sql.placeholder("content"),
      createdAt: sql.placeholder("createdAt"),
    })
    .prepare();

  const listChunksStmt = db
    .select(chunkColumns)
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType"))
      )
    )
    .orderBy(asc(agentSessionChunks.sequence))
    .prepare();

  // The bounded page. `substr` caps each chunk at the source so an 8 MB blob
  // never becomes an 8 MB JS string, and `length()` still reports the full
  // stored size. Both bounds ride the existing
  // agent_session_chunks_session_stream_sequence_idx.
  const pageChunksStmt = db
    .select({
      ...chunkColumns,
      content: sql<string>`substr(${agentSessionChunks.content}, 1, ${sql.placeholder("maxChunkChars")})`,
      contentLength: sql<number>`length(${agentSessionChunks.content})`,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        gt(agentSessionChunks.sequence, sql.placeholder("after"))
      )
    )
    .orderBy(asc(agentSessionChunks.sequence))
    .limit(sql.placeholder("limit"))
    .prepare();

  // The tail of a chunk a previous page stopped inside. `substr(content,
  // offset + 1, cap)` is the one query that makes an 8.3 MB chunk readable
  // without ever putting 8.3 MB on one response.
  const chunkRemainderStmt = db
    .select({
      ...chunkColumns,
      content: sql<string>`substr(${agentSessionChunks.content}, ${sql.placeholder("offsetPlusOne")}, ${sql.placeholder("maxChunkChars")})`,
      contentLength: sql<number>`length(${agentSessionChunks.content})`,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        eq(agentSessionChunks.sequence, sql.placeholder("sequence"))
      )
    )
    .limit(1)
    .prepare();

  // One indexed existence probe, so "the page ended" and "the stream ended"
  // are never confused — including when the byte budget, not the row limit,
  // is what closed the page.
  const hasMoreChunksStmt = db
    .select({ sequence: agentSessionChunks.sequence })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        gt(agentSessionChunks.sequence, sql.placeholder("after"))
      )
    )
    .limit(1)
    .prepare();

  const lastChunkAtStmt = db
    .select({
      lastChunkAt: sql<string | null>`max(${agentSessionChunks.createdAt})`,
    })
    .from(agentSessionChunks)
    .where(eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")))
    .prepare();

  // The tail page: rows before a sequence, newest first, each cut at the
  // source to its LAST `maxChunkChars` characters so a legacy 8 MB row never
  // becomes an 8 MB JS string. `length()` still reports the stored size.
  const tailPageChunksStmt = db
    .select({
      ...chunkColumns,
      content: sql<string>`substr(${agentSessionChunks.content}, max(1, length(${agentSessionChunks.content}) - ${sql.placeholder("maxChunkChars")} + 1))`,
      contentLength: sql<number>`length(${agentSessionChunks.content})`,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        lt(agentSessionChunks.sequence, sql.placeholder("before"))
      )
    )
    .orderBy(desc(agentSessionChunks.sequence))
    .limit(sql.placeholder("limit"))
    .prepare();

  // The head of a chunk a previous tail page served only the end of: the
  // characters up to `end`, the last `maxChunkChars` of them.
  const chunkHeadRemainderStmt = db
    .select({
      ...chunkColumns,
      content: sql<string>`substr(${agentSessionChunks.content}, max(1, ${sql.placeholder("end")} - ${sql.placeholder("maxChunkChars")} + 1), min(${sql.placeholder("end")}, ${sql.placeholder("maxChunkChars")}))`,
      contentLength: sql<number>`length(${agentSessionChunks.content})`,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        eq(agentSessionChunks.sequence, sql.placeholder("sequence"))
      )
    )
    .limit(1)
    .prepare();

  // Existence probe for "anything before this sequence" — no content read.
  const hasEarlierChunksStmt = db
    .select({ sequence: agentSessionChunks.sequence })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        lt(agentSessionChunks.sequence, sql.placeholder("before"))
      )
    )
    .limit(1)
    .prepare();

  // Descending reads: the tail of a stream. `length()` rides along so the
  // byte-budgeted callers can stop without measuring the content twice.
  const tailChunksStmt = db
    .select({
      ...chunkColumns,
      contentLength: sql<number>`length(${agentSessionChunks.content})`,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql.placeholder("streamType")),
        lt(agentSessionChunks.sequence, sql.placeholder("before"))
      )
    )
    .orderBy(desc(agentSessionChunks.sequence))
    .limit(sql.placeholder("limit"))
    .prepare();

  // The raw-stream cap: what the stream weighs, which rows are trimmable
  // (everything after the kept head, minus the marker), and the marker row.
  const rawBytesStmt = db
    .select({
      bytes: sql<number>`coalesce(sum(length(${agentSessionChunks.content})), 0)`,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql`'raw'`)
      )
    )
    .prepare();

  const rawHeadBoundaryStmt = db
    .select({ sequence: agentSessionChunks.sequence })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql`'raw'`)
      )
    )
    .orderBy(asc(agentSessionChunks.sequence))
    .limit(sql.placeholder("limit"))
    .prepare();

  const rawTrimCandidatesStmt = db
    .select({
      id: agentSessionChunks.id,
      sequence: agentSessionChunks.sequence,
      chunkKey: agentSessionChunks.chunkKey,
      contentLength: sql<number>`length(${agentSessionChunks.content})`,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql`'raw'`),
        gt(agentSessionChunks.sequence, sql.placeholder("afterSequence"))
      )
    )
    .orderBy(asc(agentSessionChunks.sequence))
    .limit(sql.placeholder("limit"))
    .prepare();

  const deleteChunkStmt = db
    .delete(agentSessionChunks)
    .where(eq(agentSessionChunks.id, sql.placeholder("id")))
    .prepare();

  const rawTrimMarkerStmt = db
    .select({
      id: agentSessionChunks.id,
      sequence: agentSessionChunks.sequence,
      content: agentSessionChunks.content,
    })
    .from(agentSessionChunks)
    .where(
      and(
        eq(agentSessionChunks.sessionId, sql.placeholder("sessionId")),
        eq(agentSessionChunks.streamType, sql`'raw'`),
        eq(agentSessionChunks.chunkKey, sql`${SESSION_RAW_STREAM_TRIM_CHUNK_KEY}`)
      )
    )
    .limit(1)
    .prepare();

  const updateChunkContentStmt = db
    .update(agentSessionChunks)
    .set({ content: sql`${sql.placeholder("content")}` })
    .where(eq(agentSessionChunks.id, sql.placeholder("id")))
    .prepare();

  // The backfill walk: sessions that hold a raw stream, in id order. Rides
  // the (session_id, stream_type, sequence) index, so listing them costs an
  // index scan rather than a read of the content.
  const rawSessionIdsStmt = database.prepare<[string, number], { sessionId: string }>(
    `SELECT DISTINCT session_id AS sessionId FROM agent_session_chunks
     WHERE session_id > ? AND stream_type = 'raw'
     ORDER BY session_id LIMIT ?`
  );

  // Upper bound of a stream's `length()`, read from the record headers only:
  // `octet_length()` of a column never loads the value's overflow pages, and
  // a stored character is at least one byte, so a stream whose bytes fit the
  // cap is under it in characters too. Measured on the live database: 1.6 ms
  // for a 112 MB stream against 49 ms for `sum(length(content))`.
  const rawOctetsStmt = database.prepare<[string], { octets: number }>(
    `SELECT coalesce(sum(octet_length(content)), 0) AS octets
       FROM agent_session_chunks
      WHERE session_id = ? AND stream_type = 'raw'`
  );

  function rawBytesOf(sessionId: string): number {
    const known = rawBytesBySession.get(sessionId);
    if (known !== undefined) return known;
    const seeded = rawBytesStmt.get({ sessionId })?.bytes ?? 0;
    rawBytesBySession.set(sessionId, seeded);
    return seeded;
  }

  /**
   * Bring a session's raw stream back under the cap: drop its oldest rows
   * after the kept head, oldest first, until the stream is at the trim
   * target, and keep one marker row — at the sequence of the first row ever
   * dropped, so it sits right after the head — saying how much went.
   * Returns what THIS call dropped (the marker keeps the running total).
   */
  function trimRawStream(sessionId: string): {
    droppedChunks: number;
    droppedBytes: number;
  } {
    const boundaryRows = rawHeadBoundaryStmt.all({
      sessionId,
      limit: rawKeptHeadChunks,
    });
    const headMaxSequence =
      boundaryRows.length > 0
        ? boundaryRows[boundaryRows.length - 1].sequence
        : 0;

    const marker = rawTrimMarkerStmt.get({ sessionId });
    let droppedBytes = 0;
    let droppedChunks = 0;
    if (marker) {
      const match = /\[… ([\d,]+) bytes in ([\d,]+) chunks dropped/.exec(marker.content);
      if (match) {
        droppedBytes = Number(match[1].replace(/,/g, "")) || 0;
        droppedChunks = Number(match[2].replace(/,/g, "")) || 0;
      }
    }

    let bytes = rawBytesOf(sessionId);
    let markerSequence = marker?.sequence ?? null;
    let cursor = headMaxSequence;
    const previouslyDroppedBytes = droppedBytes;
    const previouslyDroppedChunks = droppedChunks;
    while (bytes > rawTrimTarget) {
      const candidates = rawTrimCandidatesStmt.all({
        sessionId,
        afterSequence: cursor,
        limit: 64,
      });
      if (candidates.length === 0) break;
      let progressed = false;
      for (const row of candidates) {
        cursor = row.sequence;
        if (row.chunkKey === SESSION_RAW_STREAM_TRIM_CHUNK_KEY) continue;
        deleteChunkStmt.run({ id: row.id });
        bytes -= row.contentLength;
        droppedBytes += row.contentLength;
        droppedChunks += 1;
        progressed = true;
        if (markerSequence === null) markerSequence = row.sequence;
        if (bytes <= rawTrimTarget) break;
      }
      if (!progressed) break;
    }

    const dropped = {
      droppedChunks: droppedChunks - previouslyDroppedChunks,
      droppedBytes: droppedBytes - previouslyDroppedBytes,
    };
    if (dropped.droppedChunks === 0 || markerSequence === null) {
      rawBytesBySession.set(sessionId, bytes);
      return dropped;
    }

    const content = rawStreamTrimMarker(droppedBytes, droppedChunks);
    if (marker) {
      bytes += content.length - marker.content.length;
      updateChunkContentStmt.run({ id: marker.id, content });
    } else {
      // The freed sequence of the first dropped row: unique per session by
      // construction, and lower than every surviving row after the head.
      insertChunkStmt.run({
        id: createId(),
        sessionId,
        streamType: "raw",
        sequence: markerSequence,
        chunkKey: SESSION_RAW_STREAM_TRIM_CHUNK_KEY,
        content,
        createdAt: new Date().toISOString(),
      });
      bytes += content.length;
    }
    rawBytesBySession.set(sessionId, bytes);
    return dropped;
  }

  function trimRawStreamsOverCap(
    options: RawStreamsOverCapOptions = {}
  ): RawStreamsOverCapResult {
    const maxSessions = Math.max(1, options.maxSessions ?? Number.MAX_SAFE_INTEGER);
    const maxTrimmed = Math.max(1, options.maxTrimmedSessions ?? Number.MAX_SAFE_INTEGER);
    const result: RawStreamsOverCapResult = {
      scannedSessions: 0,
      trimmedSessions: 0,
      droppedChunks: 0,
      droppedBytes: 0,
      lockedSessions: 0,
      lastSessionId: options.afterSessionId ?? null,
      done: false,
    };

    while (result.scannedSessions < maxSessions) {
      const want = Math.min(64, maxSessions - result.scannedSessions);
      // One more than wanted, so an exhausted walk is told apart from a full batch.
      const ids = rawSessionIdsStmt.all(result.lastSessionId ?? "", want + 1);
      const batch = ids.slice(0, want);
      const exhausted = ids.length <= want;
      for (let index = 0; index < batch.length; index += 1) {
        const { sessionId } = batch[index];
        result.scannedSessions += 1;
        // Outside any transaction: the pre-weigh takes no write lock, so the
        // ~90 % of sessions already under the cap never contend for it.
        if ((rawOctetsStmt.get(sessionId)?.octets ?? 0) <= rawMaxBytes) {
          result.lastSessionId = sessionId;
          continue;
        }
        let dropped: { droppedChunks: number; droppedBytes: number } | null;
        try {
          // IMMEDIATE: take the write lock up front. A deferred transaction
          // that reads, then writes, can hit SQLITE_BUSY_SNAPSHOT with no
          // busy wait at all when another connection committed in between.
          dropped = db.transaction(
            () => {
              // Re-weighed exactly, under the lock and fresh rather than
              // from the process cache: the cache may have been seeded
              // before another process moved the stream, and the byte
              // pre-weigh over-counts multi-byte text.
              const bytes = rawBytesStmt.get({ sessionId })?.bytes ?? 0;
              rawBytesBySession.set(sessionId, bytes);
              return bytes > rawMaxBytes ? trimRawStream(sessionId) : null;
            },
            { behavior: "immediate" }
          );
        } catch (error) {
          // The transaction rolled back, so whatever the trim wrote into the
          // running total is now wrong; drop it and let the next append re-seed.
          rawBytesBySession.delete(sessionId);
          if (!isDatabaseBusyError(error)) throw error;
          // Stop here: the lock is held by another process, and every further
          // session would block the shared connection for its own busy wait.
          result.lockedSessions = 1;
          return result;
        }
        result.lastSessionId = sessionId;
        if (dropped && dropped.droppedChunks > 0) {
          result.trimmedSessions += 1;
          result.droppedChunks += dropped.droppedChunks;
          result.droppedBytes += dropped.droppedBytes;
          if (result.trimmedSessions >= maxTrimmed) {
            result.done = exhausted && index === batch.length - 1;
            return result;
          }
        }
      }
      if (exhausted) {
        result.done = true;
        break;
      }
    }
    return result;
  }

  function listChunkTail(
    sessionId: string,
    streamType: AgentSessionStreamType,
    options: SessionChunkTailOptions = {}
  ): SessionChunkTail {
    const limit = Math.max(1, options.limit ?? SESSION_CHUNK_PAGE_DEFAULT_LIMIT);
    const maxBytes = Math.max(1, options.maxBytes ?? SESSION_CHUNK_PAGE_MAX_BYTES);
    // Clamped to the page budget so the first slice always fits: the page
    // must make progress even when one chunk alone is over budget.
    const maxChunkBytes = Math.max(
      1,
      Math.min(options.maxChunkBytes ?? SESSION_CHUNK_MAX_CONTENT_BYTES, maxBytes)
    );
    const start = options.before ?? null;
    const startOffset = start === null ? 0 : Math.max(0, options.beforeOffset ?? 0);
    // Newest first while collecting; reversed once at the end.
    const collected: BoundedSessionChunk[] = [];
    let usedBytes = 0;
    let before = start ?? Number.MAX_SAFE_INTEGER;
    // Where the earliest served slice starts inside its chunk.
    let firstOffset = 0;

    /**
     * Add the slice of `row` that ends at character `end`. Returns false when
     * the page has to stop: the budget refuses it, or only the end of the
     * chunk fit and the cursor now points inside it.
     */
    const take = (
      row: ChunkRow & { contentLength: number },
      end: number
    ): boolean => {
      const capped = truncateUtf8Tail(row.content, maxChunkBytes);
      const size = Buffer.byteLength(capped.text, "utf8");
      if (collected.length > 0 && usedBytes + size > maxBytes) return false;

      const sliceStart = end - countCharacters(capped.text);
      collected.push({
        ...toSessionChunk(row),
        content: capped.text,
        contentLength: row.contentLength,
        contentOffset: sliceStart,
        contentTruncated: sliceStart > 0 || end < row.contentLength,
      });
      usedBytes += size;
      before = row.sequence;
      firstOffset = sliceStart;
      return sliceStart === 0;
    };

    const finish = (): SessionChunkTail => {
      collected.reverse();
      const firstSequence = collected[0]?.sequence ?? null;
      const probeBefore = firstSequence ?? before;
      return {
        streamType,
        chunks: collected,
        firstSequence,
        firstOffset: firstSequence === null ? 0 : firstOffset,
        lastSequence: collected[collected.length - 1]?.sequence ?? null,
        hasEarlier:
          (firstSequence !== null && firstOffset > 0) ||
          Boolean(
            hasEarlierChunksStmt.get({ sessionId, streamType, before: probeBefore })
          ),
      };
    };

    // Resume inside the chunk the previous page served only the end of.
    if (start !== null && startOffset > 0) {
      const remainder = chunkHeadRemainderStmt.get({
        sessionId,
        streamType,
        sequence: start,
        end: startOffset,
        maxChunkChars: maxChunkBytes,
      });
      // A chunk that shrank or vanished falls through to the rows before it
      // rather than looping on a cursor that can never move.
      if (remainder && remainder.contentLength >= startOffset) {
        if (!take(remainder, startOffset)) return finish();
      }
    }

    let exhausted = false;
    while (collected.length < limit && !exhausted) {
      const batchSize = Math.min(
        limit - collected.length,
        CHUNK_PAGE_BATCH_ROWS,
        batchRows(Math.max(1, maxBytes - usedBytes), maxChunkBytes)
      );
      const rows = tailPageChunksStmt.all({
        sessionId,
        streamType,
        before,
        // Characters, as SQLite counts them: a cheap upper bound on bytes,
        // which truncateUtf8Tail then cuts to the exact byte cap.
        maxChunkChars: maxChunkBytes,
        limit: batchSize,
      });
      if (rows.length < batchSize) exhausted = true;
      for (const row of rows) {
        if (!take(row, row.contentLength)) return finish();
      }
    }

    return finish();
  }

  function readTail(
    sessionId: string,
    streamType: AgentSessionStreamType,
    maxChars: number
  ): string | null {
    const parts: string[] = [];
    let chars = 0;
    let before = Number.MAX_SAFE_INTEGER;
    while (chars < maxChars) {
      const rows = tailChunksStmt.all({
        sessionId,
        streamType,
        before,
        limit: CHUNK_PAGE_BATCH_ROWS,
      });
      for (const row of rows) {
        before = row.sequence;
        parts.push(row.content);
        chars += row.contentLength;
        if (chars >= maxChars) break;
      }
      if (rows.length < CHUNK_PAGE_BATCH_ROWS) break;
    }
    if (parts.length === 0) return null;
    const joined = parts.reverse().join("");
    if (!joined.trim()) return null;
    return joined.length > maxChars ? joined.slice(-maxChars) : joined;
  }

  const updateLastNonEmptyTextStmt = db
    .update(agentSessions)
    // Wrapped in `sql` because `.set()` only accepts SQL / literal values.
    .set({ lastNonEmptyText: sql`${sql.placeholder("lastNonEmptyText")}` })
    .where(eq(agentSessions.id, sql.placeholder("sessionId")))
    .prepare();

  function listChunkPage(
    sessionId: string,
    streamType: AgentSessionStreamType,
    options: SessionChunkPageOptions = {}
  ): SessionChunkPage {
    const limit = Math.max(1, options.limit ?? SESSION_CHUNK_PAGE_DEFAULT_LIMIT);
    const maxBytes = Math.max(
      1,
      options.maxBytes ?? SESSION_CHUNK_PAGE_MAX_BYTES
    );
    // Clamped to the page budget so a page always carries something: without
    // it, a per-chunk cap above the budget would leave nothing to deliver.
    const maxChunkBytes = Math.max(
      1,
      Math.min(
        options.maxChunkBytes ?? SESSION_CHUNK_MAX_CONTENT_BYTES,
        maxBytes
      )
    );

    // Sequences start at 1, so 0 is "from the beginning of the stream".
    const start = options.after ?? 0;
    const startOffset = Math.max(0, options.afterOffset ?? 0);
    let cursor = start;
    // Characters of the chunk at `cursor` delivered so far; 0 means the
    // cursor sits between chunks.
    let offset = 0;
    let usedBytes = 0;
    const chunks: BoundedSessionChunk[] = [];

    /**
     * Add one row (or the tail of one) to the page. Returns false when the
     * page has to stop — either the budget is spent or the chunk is only
     * partly delivered and the cursor now points inside it.
     */
    const take = (
      row: {
        id: string;
        sessionId: string;
        streamType: string;
        sequence: number;
        chunkKey: string | null;
        content: string;
        contentLength: number;
        createdAt: string | null;
      },
      contentOffset: number
    ): boolean => {
      const capped = truncateUtf8(row.content, maxChunkBytes);
      const size = Buffer.byteLength(capped.text, "utf8");
      // Never an empty page over budget: the first slice always goes in, so a
      // client following the cursor always makes progress.
      if (chunks.length > 0 && usedBytes + size > maxBytes) return false;

      const delivered = contentOffset + countCharacters(capped.text);
      const complete = delivered >= row.contentLength;
      chunks.push({
        id: row.id,
        sessionId: row.sessionId,
        streamType: row.streamType as AgentSessionStreamType,
        sequence: row.sequence,
        chunkKey: row.chunkKey,
        content: capped.text,
        createdAt: row.createdAt,
        contentLength: row.contentLength,
        contentTruncated: !complete || contentOffset > 0,
        contentOffset,
      });
      usedBytes += size;
      cursor = row.sequence;
      offset = complete ? 0 : delivered;
      return complete;
    };

    // Resume inside the chunk the previous page stopped in, before moving on.
    if (startOffset > 0) {
      const remainder = chunkRemainderStmt.get({
        sessionId,
        streamType,
        sequence: start,
        offsetPlusOne: startOffset + 1,
        maxChunkChars: maxChunkBytes,
      });
      if (remainder && remainder.contentLength > startOffset) {
        if (!take(remainder, startOffset)) {
          return finish();
        }
      } else {
        // The chunk shrank or vanished: fall through to whatever follows it
        // rather than looping on a cursor that can never advance.
        offset = 0;
      }
    }

    let exhausted = false;
    while (chunks.length < limit && !exhausted) {
      const batchSize = Math.min(
        limit - chunks.length,
        CHUNK_PAGE_BATCH_ROWS,
        batchRows(Math.max(1, maxBytes - usedBytes), maxChunkBytes)
      );
      const rows = pageChunksStmt.all({
        sessionId,
        streamType,
        after: cursor,
        // SQLite's substr() counts characters, not bytes; this is the cheap
        // upper bound, and truncateUtf8 below cuts to the exact byte cap.
        maxChunkChars: maxChunkBytes,
        limit: batchSize,
      });
      if (rows.length < batchSize) exhausted = true;

      // `take` returns false both when the budget refuses the chunk and when
      // the chunk is only partly delivered; either way the page ends here and
      // the cursor says where to resume.
      for (const row of rows) {
        if (!take(row, 0)) return finish();
      }
    }

    return finish();

    function finish(): SessionChunkPage {
      return {
        streamType,
        chunks,
        nextAfter: chunks.length > 0 ? cursor : (options.after ?? null),
        nextOffset: chunks.length > 0 ? offset : startOffset,
        // More of the current chunk, or another chunk after it. One indexed
        // probe, so "the page ended" and "the stream ended" are never
        // confused — including when the byte budget closed the page.
        hasMore:
          offset > 0 ||
          Boolean(
            hasMoreChunksStmt.get({
              sessionId,
              streamType,
              after: chunks.length > 0 ? cursor : start,
            })
          ),
      };
    }
  }

  function appendChunk(
    input: AppendSessionChunkInput
  ): AppendSessionChunkResult {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const suppliedKey = input.chunkKey ?? null;

    const findDuplicate = (chunkKey: string) =>
      selectExistingByKeyStmt.get({
        sessionId: input.sessionId,
        streamType: input.streamType,
        chunkKey,
      });

    // The fast path, unchanged: a caller-supplied key answers the duplicate
    // question with one indexed lookup, without reading the content at all.
    if (suppliedKey) {
      const existing = findDuplicate(suppliedKey);
      if (existing) {
        return {
          inserted: false,
          chunk: toSessionChunk(existing),
        };
      }
    }

    // Hashed BEFORE the cap, then capped. The digest has to identify the
    // chunk the writer produced, not the lossy shape storage keeps: two
    // distinct oversized chunks sharing a head and a tail cap to the same
    // bytes, and a digest taken afterwards would call the second one a
    // duplicate. See `deriveChunkKey`.
    const chunkKey = suppliedKey ?? deriveChunkKey(input.content);
    const content = capChunkContent(input.content).content;

    // Keyless writers get the same check on the derived key. Deliberately
    // before the sequence reservation below: a deduped write must cost a
    // lookup and nothing else — no row, and no hole in the session's
    // sequence either.
    if (!suppliedKey) {
      const existing = findDuplicate(chunkKey);
      if (existing) {
        return {
          inserted: false,
          chunk: toSessionChunk(existing),
        };
      }
    }

    const sequenceRow = reserveSequenceStmt.get({
      sessionId: input.sessionId,
      updatedAt: createdAt,
    });
    if (!sequenceRow) {
      throw new Error(
        `Failed to reserve sequence for session ${input.sessionId}`
      );
    }

    const chunk: SessionChunk = {
      id: createId(),
      sessionId: input.sessionId,
      streamType: input.streamType,
      sequence: sequenceRow.sequence,
      chunkKey,
      content,
      createdAt,
    };

    insertChunkStmt.run({
      id: chunk.id,
      sessionId: chunk.sessionId,
      streamType: chunk.streamType,
      sequence: chunk.sequence,
      chunkKey: chunk.chunkKey,
      content: chunk.content,
      createdAt: chunk.createdAt ?? createdAt,
    });

    if (input.streamType === "output" || input.streamType === "response") {
      // Deliberately `input.content`, not the capped chunk. The last non-empty
      // line is the agent's final word, which is exactly the part an elided
      // middle could swallow — and the marker itself would become the "last
      // line" if the cap ate everything after it. Reading the uncapped text
      // keeps the sessions list and the completion toast honest.
      const lastNonEmptyText = extractLastNonEmptyText(input.content);
      if (lastNonEmptyText) {
        updateLastNonEmptyTextStmt.run({
          lastNonEmptyText,
          sessionId: input.sessionId,
        });
      }
    } else if (input.streamType === "raw") {
      // The per-session cap. `length()` in SQLite counts characters and
      // `Buffer.byteLength` counts bytes; the running total mixes the two on
      // purpose only in the sense that both are upper-bounded by bytes — the
      // seed reads characters, the increments read bytes, and the cap is a
      // ceiling, not an accounting.
      const bytes = rawBytesOf(input.sessionId) + Buffer.byteLength(content, "utf8");
      rawBytesBySession.set(input.sessionId, bytes);
      if (bytes > rawMaxBytes) trimRawStream(input.sessionId);
    }

    return {
      inserted: true,
      chunk,
    };
  }

  return {
    appendChunk(input: AppendSessionChunkInput): AppendSessionChunkResult {
      return db.transaction(() => appendChunk(input));
    },
    listChunks(
      sessionId: string,
      streamType: AgentSessionStreamType
    ): SessionChunk[] {
      return listChunksStmt.all({ sessionId, streamType }).map(toSessionChunk);
    },
    listChunkPage(
      sessionId: string,
      streamType: AgentSessionStreamType,
      options?: SessionChunkPageOptions
    ): SessionChunkPage {
      return listChunkPage(sessionId, streamType, options);
    },
    listChunkTail,
    readTail,
    lastChunkAt(sessionId: string): string | null {
      return lastChunkAtStmt.get({ sessionId })?.lastChunkAt ?? null;
    },
    trimRawStreamsOverCap,
  };
}

/**
 * SQLITE_BUSY / SQLITE_LOCKED and their extended codes (`SQLITE_BUSY_SNAPSHOT`,
 * …): another connection holds the lock. Transient by nature, so a caller
 * skips and retries later instead of failing.
 */
export function isDatabaseBusyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" &&
    (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))
  );
}

let defaultStore: SessionChunkStore | null = null;

function getDefaultStore(): SessionChunkStore {
  if (!defaultStore) {
    defaultStore = createSessionChunkStore(sqlite);
  }
  return defaultStore;
}

export function appendSessionChunk(
  input: AppendSessionChunkInput
): AppendSessionChunkResult {
  return getDefaultStore().appendChunk(input);
}

export function listSessionChunks(
  sessionId: string,
  streamType: AgentSessionStreamType
): SessionChunk[] {
  return getDefaultStore().listChunks(sessionId, streamType);
}

/**
 * Bounded counterpart to `listSessionChunks`: one page of a single stream.
 * Kept as a separate export on purpose — `listSessionChunks` still serves the
 * whole stream to the forensic collector and the Arij-action scanner, which
 * summarise it server-side and never ship it to a client.
 */
export function listSessionChunkPage(
  sessionId: string,
  streamType: AgentSessionStreamType,
  options?: SessionChunkPageOptions
): SessionChunkPage {
  return getDefaultStore().listChunkPage(sessionId, streamType, options);
}

/** The most recent chunks of a stream, ascending — see `SessionChunkStore.listChunkTail`. */
export function listSessionChunkTail(
  sessionId: string,
  streamType: AgentSessionStreamType,
  options?: SessionChunkTailOptions
): SessionChunkTail {
  return getDefaultStore().listChunkTail(sessionId, streamType, options);
}

/** The last `maxChars` characters of a stream — see `SessionChunkStore.readTail`. */
export function readSessionStreamTail(
  sessionId: string,
  streamType: AgentSessionStreamType,
  maxChars: number
): string | null {
  return getDefaultStore().readTail(sessionId, streamType, maxChars);
}

/**
 * One batch of the historical raw-stream trim on the default store. What keeps
 * it correct beside the write path is the fresh weigh under the write lock,
 * not a shared cache: instrumentation and each route bundle (and every HMR
 * generation) may hold their own module instance, hence their own store and
 * running totals.
 */
export function trimRawStreamsOverCap(
  options?: RawStreamsOverCapOptions
): RawStreamsOverCapResult {
  return getDefaultStore().trimRawStreamsOverCap(options);
}

export function lastSessionChunkAt(sessionId: string): string | null {
  return getDefaultStore().lastChunkAt(sessionId);
}
