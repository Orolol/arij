"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useSessionPolling } from "./useSessionPolling";
import type {
  AgentSessionStreamType,
  BoundedSessionChunk,
} from "@/lib/agent-sessions/chunks";
import {
  countCharacters,
  fetchSessionChunkPage,
  fetchSessionChunkTailPage,
  type SessionStreamTailSeed,
} from "@/lib/agent-sessions/session-detail";

/**
 * Shared paging for the live log and response pane. Each renderer keeps its
 * own presentation, while cursors, cancellation and completion reads agree.
 *
 * The session detail route used to inline all three streams in full — 112 MB
 * for the worst session on the live database, read synchronously on the one
 * shared connection, so opening the page stalled every other request. This
 * starts from the small preview the detail payload carried and walks forward
 * with `?stream=&after=`, one bounded page per click (or per poll while the
 * session is still writing).
 *
 * The `raw` preview is the END of the stream (a tail seed), not its head: a
 * finished 112 MB session used to open on its first 64 KiB. From a tail seed
 * the pager walks BACK with `?stream=&before=` (`loadEarlier`, prepending),
 * and keeps following forward from the tail's cursor while the session runs.
 */

export interface SessionStreamSeed {
  chunks: BoundedSessionChunk[];
  nextAfter: number | null;
  /** Characters of the chunk at `nextAfter` already delivered, if any. */
  nextOffset?: number;
  hasMore: boolean;
}

export interface SessionStreamPagerOptions {
  projectId: string;
  sessionId: string;
  streamType: AgentSessionStreamType;
  /**
   * Preview page from `GET .../sessions/:id`; the rest is fetched on demand.
   * A tail seed (`raw`) also carries the backward cursor.
   */
  seed: (SessionStreamSeed & Partial<SessionStreamTailSeed>) | null;
  /** True when the route could not read the stream at all. */
  unavailable?: boolean;
  /**
   * While the session can still write — running, or queued and about to —
   * the stream tails itself from its own cursor, and the switch to false
   * earns one last forward read (queued behind a poll still in flight).
   */
  isRunning: boolean;
  errorMessages?: { unreadable: string; loadFailed: string };
}

export interface SessionStreamPager {
  chunks: BoundedSessionChunk[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  /** Chunks on screen only in part — counted per CHUNK, not per slice. */
  truncatedCount: number;
  loadMore: () => Promise<void>;
  /** Output exists before what is on screen (a tail seed only). */
  hasEarlier: boolean;
  loadingEarlier: boolean;
  /**
   * Prepend the page just before what is on screen. Resolves to the number
   * of chunks prepended — 0 for an empty, unreadable or failed page — so a
   * caller holding the scroll for the prepend knows when none is coming.
   */
  loadEarlier: () => Promise<number>;
}

export function useSessionStreamPager({
  projectId,
  sessionId,
  streamType,
  seed,
  unavailable = false,
  isRunning,
  errorMessages,
}: SessionStreamPagerOptions): SessionStreamPager {
  // Read into plain strings so `loadMore` depends on the messages rather
  // than on the translator identity, which changes on every render.
  const t = useTranslations("SessionLive");
  const unreadableCopy = errorMessages?.unreadable ?? t("log.streamUnreadable");
  const loadFailedCopy = errorMessages?.loadFailed ?? t("log.loadMoreFailed");
  const loadEarlierFailedCopy = t("log.loadEarlierFailed");
  const key = JSON.stringify([projectId, sessionId, streamType]);
  const [chunks, setChunks] = useState<BoundedSessionChunk[]>(
    seed?.chunks ?? []
  );
  const [hasMore, setHasMore] = useState(seed?.hasMore ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held in refs, not state: the poll below must never read a stale cursor
  // and re-append chunks it already has. The cursor has two halves — the last
  // sequence delivered, and how much of THAT chunk went out, which is
  // non-zero only for a chunk too large to fit one page.
  const cursor = useRef<number | null>(seed?.nextAfter ?? null);
  const cursorOffset = useRef<number>(seed?.nextOffset ?? 0);
  // The backward cursor: the earliest sequence on screen, and how much of
  // that chunk's head is still missing (non-zero for a chunk shown by its end).
  const [hasEarlier, setHasEarlier] = useState(seed?.hasEarlier ?? false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const earliest = useRef<number | null>(seed?.firstSequence ?? null);
  const earliestOffset = useRef<number>(seed?.firstOffset ?? 0);
  const earlierInFlight = useRef(false);
  // Bumped by every (re)seed. A read that set out under an older generation
  // lands on a list it no longer describes, so its answer is dropped instead
  // of being appended to — or moving the cursors of — the new seed. A change
  // of identity also aborts the forward read (useSessionPolling); the
  // generation covers the re-seed that keeps the identity (below) and the
  // backward read, which has no signal of its own.
  const generation = useRef(0);

  const seedHasChunks = (seed?.chunks?.length ?? 0) > 0;

  // Capture a preview once per identity. A poll can replace the seed object
  // without discarding pages already loaded from this stream. Two things
  // re-seed:
  //  - a different session (or stream) in the same mounted page;
  //  - the FIRST seed that has chunks, after an empty one. A session opened
  //    while queued is seeded with nothing; if it then finishes between two
  //    reads of the page, this pager never follows it live, and without this
  //    the tail the page has since read would never reach the screen. A
  //    queued session that starts is re-seeded from its tail the same way,
  //    rather than following from the head.
  const [identity, setIdentity] = useState({
    key,
    seed,
    withChunks: seedHasChunks,
  });
  if (identity.key !== key || (seedHasChunks && !identity.withChunks)) {
    setIdentity({ key, seed, withChunks: seedHasChunks });
    setChunks(seed?.chunks ?? []);
    setHasMore(seed?.hasMore ?? false);
    setError(null);
    setLoading(false);
    setHasEarlier(seed?.hasEarlier ?? false);
  }
  useEffect(() => {
    generation.current += 1;
    cursor.current = identity.seed?.nextAfter ?? null;
    cursorOffset.current = identity.seed?.nextOffset ?? 0;
    earliest.current = identity.seed?.firstSequence ?? null;
    earliestOffset.current = identity.seed?.firstOffset ?? 0;
  }, [identity]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    const startedUnder = generation.current;
    try {
      const page = await fetchSessionChunkPage(projectId, sessionId, streamType, {
        after: cursor.current,
        offset: cursorOffset.current,
        signal,
      });
      if (signal.aborted) return;
      if (startedUnder === generation.current) {
        cursor.current = page.nextAfter;
        cursorOffset.current = page.nextOffset ?? 0;
        setHasMore(page.hasMore);
        setError(
          page.chunkStreamsUnavailable ? unreadableCopy : null
        );
        if (Array.isArray(page.chunks) && page.chunks.length > 0) {
          setChunks((current) => [...current, ...page.chunks]);
        }
      }
    } catch {
      if (!signal.aborted) setError(loadFailedCopy);
    }
    if (!signal.aborted) setLoading(false);
  }, [projectId, sessionId, streamType, unreadableCopy, loadFailedCopy]);

  // A running session appends as it writes; a finished one waits for a click.
  // The final read matters for output written at completion: the switch to
  // not-running queues one last read behind any poll still in flight.
  const loadMore = useSessionPolling(key, load, isRunning, 3000, { enabled: !unavailable });

  const loadEarlier = useCallback(async (): Promise<number> => {
    if (earlierInFlight.current || earliest.current === null) return 0;
    earlierInFlight.current = true;
    setLoadingEarlier(true);
    const startedUnder = generation.current;
    // `.catch` rather than try/finally: the React Compiler stops on a
    // `finally` clause, and stopping leaves the hook unread by its rules.
    const page = await fetchSessionChunkTailPage(projectId, sessionId, streamType, {
      before: earliest.current,
      beforeOffset: earliestOffset.current,
    }).catch(() => null);
    earlierInFlight.current = false;
    setLoadingEarlier(false);
    if (!page) {
      setError(loadEarlierFailedCopy);
      return 0;
    }
    if (startedUnder !== generation.current) return 0;
    // An unreadable page leaves the cursor where it was, so a retry asks
    // for the same page rather than skipping it.
    setError(page.chunkStreamsUnavailable ? unreadableCopy : null);
    if (page.chunkStreamsUnavailable) return 0;
    if (page.firstSequence !== null) {
      earliest.current = page.firstSequence;
      earliestOffset.current = page.firstOffset ?? 0;
    }
    setHasEarlier(page.hasEarlier);
    if (!Array.isArray(page.chunks) || page.chunks.length === 0) return 0;
    const prepended = page.chunks;
    setChunks((current) => [...prepended, ...current]);
    return prepended.length;
  }, [projectId, sessionId, streamType, unreadableCopy, loadEarlierFailedCopy]);

  /**
   * Chunks that are on screen only in part.
   *
   * Counted per CHUNK, not per slice — one 8.3 MB chunk walked out over five
   * pages is one oversized chunk, not five — and a chunk whose slices cover
   * it from its start to its end no longer counts at all: after "Load more"
   * or "Load earlier" has walked it out, the pane really is showing all of
   * it. A tail slice reaches the END of its chunk but not its start, so both
   * ends are checked. `countCharacters` counts code points, because
   * `contentLength` comes from SQLite `length()` and a JS `.length`
   * over-counts anything astral — agent output carries emoji routinely.
   */
  const truncatedCount = (() => {
    const spanBySequence = new Map<
      number,
      { start: number; reach: number; length: number }
    >();
    for (const chunk of chunks) {
      if (!chunk.contentTruncated && chunk.contentOffset === 0) continue;
      const reach = chunk.contentOffset + countCharacters(chunk.content);
      const seen = spanBySequence.get(chunk.sequence);
      spanBySequence.set(chunk.sequence, {
        start: Math.min(chunk.contentOffset, seen?.start ?? chunk.contentOffset),
        reach: Math.max(reach, seen?.reach ?? 0),
        length: chunk.contentLength,
      });
    }
    let count = 0;
    for (const { start, reach, length } of spanBySequence.values()) {
      if (start > 0 || reach < length) count += 1;
    }
    return count;
  })();

  return {
    chunks,
    hasMore,
    loading,
    error,
    truncatedCount,
    loadMore,
    hasEarlier,
    loadingEarlier,
    loadEarlier,
  };
}
