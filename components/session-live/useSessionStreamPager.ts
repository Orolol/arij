"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { usePolling } from "@/hooks/usePolling";
import type { SessionStreamSeed } from "@/components/sessions/SessionOutputStream";
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
 * One chunk stream, paged — the cursor discipline of
 * `components/sessions/SessionOutputStream.tsx` lifted out of the component so
 * the LIVE LOG can render the same stream its own way (line grammar, glyphs,
 * per-chunk timestamps) without forking the paging.
 *
 * `SessionOutputStream` itself is untouched: 16 tests pin it, and the Réponse
 * pane on this screen still mounts it as-is.
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
   * earns one last forward read.
   */
  isRunning: boolean;
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
}: SessionStreamPagerOptions): SessionStreamPager {
  // Read into plain strings so `loadMore` depends on the two messages rather
  // than on the translator identity, which changes on every render.
  const t = useTranslations("SessionLive");
  const unreadableCopy = t("log.streamUnreadable");
  const loadFailedCopy = t("log.loadMoreFailed");
  const loadEarlierFailedCopy = t("log.loadEarlierFailed");
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
  const inFlight = useRef(false);
  // A forward read asked for while one was in flight — the final read at the
  // end of a run must not be dropped because a poll was still out.
  const queued = useRef(false);
  // The backward cursor: the earliest sequence on screen, and how much of
  // that chunk's head is still missing (non-zero for a chunk shown by its end).
  const [hasEarlier, setHasEarlier] = useState(seed?.hasEarlier ?? false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const earliest = useRef<number | null>(seed?.firstSequence ?? null);
  const earliestOffset = useRef<number>(seed?.firstOffset ?? 0);
  const earlierInFlight = useRef(false);
  // Bumped by every (re)seed. A read that set out under an older generation
  // lands on a list it no longer describes, so its answer is dropped instead
  // of being appended to — or moving the cursors of — the new seed.
  const generation = useRef(0);

  const seedHasChunks = (seed?.chunks?.length ?? 0) > 0;
  const seededIdentity = useRef<string | null>(null);
  const seededWithChunks = useRef(seedHasChunks);

  // Seeding is keyed on the identity of the stream, not on the seed object:
  // the page may re-send a preview on later reads, and re-seeding from each
  // one would throw away everything paged in since. Two things re-seed:
  //  - a different session (or stream) in the same mounted page;
  //  - the FIRST seed that has chunks, after an empty one. A session opened
  //    while queued is seeded with nothing; if it then finishes between two
  //    reads of the page, this pager never follows it live, and without this
  //    the tail the page has since read would never reach the screen. A
  //    queued session that starts is re-seeded from its tail the same way,
  //    rather than following from the head.
  useEffect(() => {
    const identity = `${projectId}\u0000${sessionId}\u0000${streamType}`;
    const newIdentity = seededIdentity.current !== identity;
    const firstChunks = seedHasChunks && !seededWithChunks.current;
    seededIdentity.current = identity;
    if (!newIdentity && !firstChunks) return;
    seededWithChunks.current = seedHasChunks;
    generation.current += 1;
    setChunks(seed?.chunks ?? []);
    setHasMore(seed?.hasMore ?? false);
    setError(null);
    setHasEarlier(seed?.hasEarlier ?? false);
    cursor.current = seed?.nextAfter ?? null;
    cursorOffset.current = seed?.nextOffset ?? 0;
    earliest.current = seed?.firstSequence ?? null;
    earliestOffset.current = seed?.firstOffset ?? 0;
    // `seed` itself is read, not watched — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sessionId, streamType, seedHasChunks]);

  const loadMore = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    setLoading(true);
    try {
      do {
        queued.current = false;
        const startedUnder = generation.current;
        const page = await fetchSessionChunkPage(projectId, sessionId, streamType, {
          after: cursor.current,
          offset: cursorOffset.current,
        });
        if (startedUnder !== generation.current) continue;
        cursor.current = page.nextAfter;
        cursorOffset.current = page.nextOffset ?? 0;
        setHasMore(page.hasMore);
        setError(
          page.chunkStreamsUnavailable ? unreadableCopy : null
        );
        if (Array.isArray(page.chunks) && page.chunks.length > 0) {
          setChunks((current) => [...current, ...page.chunks]);
        }
      } while (queued.current);
    } catch {
      setError(loadFailedCopy);
    } finally {
      inFlight.current = false;
      queued.current = false;
      setLoading(false);
    }
  }, [projectId, sessionId, streamType, unreadableCopy, loadFailedCopy]);

  const loadEarlier = useCallback(async (): Promise<number> => {
    if (earlierInFlight.current || earliest.current === null) return 0;
    earlierInFlight.current = true;
    setLoadingEarlier(true);
    let prepended = 0;
    try {
      const startedUnder = generation.current;
      const page = await fetchSessionChunkTailPage(projectId, sessionId, streamType, {
        before: earliest.current,
        beforeOffset: earliestOffset.current,
      });
      // An unreadable page leaves the cursor where it was, so a retry asks
      // for the same page rather than skipping it.
      if (startedUnder === generation.current) {
        setError(page.chunkStreamsUnavailable ? unreadableCopy : null);
        if (!page.chunkStreamsUnavailable) {
          if (page.firstSequence !== null) {
            earliest.current = page.firstSequence;
            earliestOffset.current = page.firstOffset ?? 0;
          }
          setHasEarlier(page.hasEarlier);
          if (Array.isArray(page.chunks) && page.chunks.length > 0) {
            prepended = page.chunks.length;
            setChunks((current) => [...page.chunks, ...current]);
          }
        }
      }
    } catch {
      setError(loadEarlierFailedCopy);
    } finally {
      earlierInFlight.current = false;
      setLoadingEarlier(false);
    }
    return prepended;
  }, [projectId, sessionId, streamType, unreadableCopy, loadEarlierFailedCopy]);

  // A running session appends as it writes; a finished one waits for a click.
  usePolling(loadMore, 3000, isRunning && !unavailable, { immediate: false });

  // One last forward read when the run ends: the interval stops with it, and
  // whatever the process wrote after the previous poll would otherwise stay
  // off screen until a click. Queued behind a poll still in flight.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning && !unavailable) void loadMore();
    wasRunning.current = isRunning;
  }, [isRunning, unavailable, loadMore]);

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
