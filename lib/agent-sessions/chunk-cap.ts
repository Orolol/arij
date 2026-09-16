/**
 * The write-path cap on a single `agent_session_chunks.content`, and the
 * marker that says where the middle of a capped chunk went.
 *
 * Why a module of its own: the chunk store imports `@/lib/db`, so it can
 * never be pulled into a client bundle — and the session detail is exactly
 * where these markers have to be legible. This file is the vocabulary both
 * ends share. It touches no database, no `fs` and no `Buffer`; the
 * Buffer-based cut itself stays server-side in `chunks.ts`.
 *
 * The measurements behind the numbers, from the live database: 126,953 chunk
 * rows holding 395.5 MB of content, the largest single chunk 8.3 MB (one CLI
 * result blob written as one row) and the largest single session 51.3 MB.
 * Nothing pruned it and nothing bounded it on the way in.
 */

/**
 * Ceiling on the UTF-8 bytes stored for one chunk.
 *
 * Deliberately the same 256 KiB as `SESSION_CHUNK_MAX_CONTENT_BYTES`, the
 * per-chunk cap the bounded READ already applies: a chunk at the write cap is
 * one that the page can now always deliver whole, so the pagination cursor
 * stops having to walk an 8.3 MB row out over five pages. They are separate
 * constants because they answer separate questions — what may be kept, and
 * what may be served — and one could move without the other.
 */
export const SESSION_CHUNK_MAX_STORED_BYTES = 256 * 1024;

/**
 * Head and tail kept when a chunk is over the cap, in UTF-8 bytes.
 *
 * The 80/15 split follows `capPromptCommentBody` in
 * `lib/claude/prompt-sections.ts`: the head is where a command, its arguments
 * and the start of its output live, the tail is where the verdict does, and
 * the middle of a multi-megabyte blob is the part nobody reads. The ~8 KiB
 * the two leave under the cap is slack for the marker, which is ~70 bytes —
 * so a capped chunk is always strictly under {@link
 * SESSION_CHUNK_MAX_STORED_BYTES}, never one marker over it.
 */
export const SESSION_CHUNK_STORED_HEAD_BYTES = 208 * 1024;
export const SESSION_CHUNK_STORED_TAIL_BYTES = 40 * 1024;

/**
 * The invariant fixed part of the marker. Derived from the cap rather than
 * spelled out, so the sentence a reader sees and the limit the code enforces
 * cannot drift apart.
 */
export const SESSION_CHUNK_ELISION_LABEL = `chunk capped by Arij at ${
  SESSION_CHUNK_MAX_STORED_BYTES / 1024
} KiB`;

/**
 * The line written between the head and the tail of a capped chunk.
 *
 * Counted in BYTES, not characters: bytes are what the cap is expressed in
 * and what the cut is measured against, and reporting characters here would
 * be a second, differently-derived number for the same elision.
 *
 * Persisted into the stored chunk and parsed back by regex, so the numeral
 * is pinned to "en-US" and never follows the interface locale.
 */
export function chunkElisionMarker(elidedBytes: number): string {
  return `[… ${elidedBytes.toLocaleString(
    "en-US"
  )} bytes elided — ${SESSION_CHUNK_ELISION_LABEL} …]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Source of a regular expression matching exactly what
 * {@link chunkElisionMarker} writes — the digits and thousands separators are
 * the only variable part.
 *
 * Exposed as a source string rather than a shared `RegExp` on purpose: a
 * `RegExp` object carries `lastIndex`, and two callers sharing one would
 * interfere. Build your own with the two helpers below.
 */
const MARKER_SOURCE = `\\[… [\\d,]+ bytes elided — ${escapeRegExp(
  SESSION_CHUNK_ELISION_LABEL
)} …\\]`;

/**
 * A fresh capturing splitter: `text.split(chunkElisionMarkerSplitter())`
 * yields the surrounding text and the markers themselves, interleaved, so a
 * renderer can style the markers without exploding the rest into one node per
 * line.
 */
export function chunkElisionMarkerSplitter(): RegExp {
  return new RegExp(`(${MARKER_SOURCE})`);
}

/** True when `line` is, on its own, one of Arij's elision markers. */
export function isChunkElisionMarker(line: string): boolean {
  return new RegExp(`^${MARKER_SOURCE}$`).test(line.trim());
}

// ---------------------------------------------------------------------------
// The per-SESSION cap on the raw stream
// ---------------------------------------------------------------------------

/**
 * Ceiling on the UTF-8 bytes a session's `raw` stream keeps, enforced on the
 * write path.
 *
 * The per-chunk cap above bounds one row; nothing bounded the number of rows.
 * Measured on the live database on 2026-09-11: 300,644 raw rows holding
 * 869 MB, 90 % of it in 37 sessions above 4 MiB, all builds run by a CLI that
 * streams a progress frame per pipe read. A time-based retention cannot reach
 * that shape — the bytes arrive in one afternoon — so the bound sits where the
 * bytes do: once a session's raw stream passes this ceiling, its oldest rows
 * after the head are dropped and one marker says how much went.
 *
 * What survives is what the readers use: the head (the prompt echo and the
 * first commands, which the session detail seeds its preview from) and the
 * tail (where the failure and the verdict live, which forensic diagnostics
 * and the LIVE LOG read). The middle of a multi-megabyte stream is the part
 * nobody opens.
 */
export const SESSION_RAW_STREAM_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Raw rows always kept at the head of the stream, whatever the cap. Twenty is
 * the size of the preview the session detail seeds the LIVE LOG with.
 */
export const SESSION_RAW_STREAM_KEPT_HEAD_CHUNKS = 20;

/**
 * Where a trim stops: below this share of the cap, so that a stream hovering
 * at the ceiling is trimmed in batches rather than one row per append.
 */
export const SESSION_RAW_STREAM_TRIM_TO_RATIO = 0.75;

/**
 * `chunk_key` of the one row that stands in for the dropped middle of a
 * capped raw stream. Disjoint from every provider key (`stdout:N`,
 * `stderr:N`) and from the derived `sha256-…` keys.
 */
export const SESSION_RAW_STREAM_TRIM_CHUNK_KEY = "raw-trimmed";

/** The invariant part of the raw-stream trim marker. */
export const SESSION_RAW_STREAM_TRIM_LABEL = `raw stream capped by Arij at ${
  SESSION_RAW_STREAM_MAX_BYTES / (1024 * 1024)
} MiB per session`;

/**
 * The line stored in the marker row of a trimmed raw stream. One row per
 * session, rewritten as the total grows; `en-US` for the same reason as the
 * chunk marker.
 */
export function rawStreamTrimMarker(
  droppedBytes: number,
  droppedChunks: number
): string {
  return `[… ${droppedBytes.toLocaleString("en-US")} bytes in ${droppedChunks.toLocaleString(
    "en-US"
  )} chunks dropped — ${SESSION_RAW_STREAM_TRIM_LABEL} …]`;
}

const TRIM_MARKER_SOURCE = `\\[… [\\d,]+ bytes in [\\d,]+ chunks dropped — ${escapeRegExp(
  SESSION_RAW_STREAM_TRIM_LABEL
)} …\\]`;

/** True when `line` is, on its own, a raw-stream trim marker. */
export function isRawStreamTrimMarker(line: string): boolean {
  return new RegExp(`^${TRIM_MARKER_SOURCE}$`).test(line.trim());
}
