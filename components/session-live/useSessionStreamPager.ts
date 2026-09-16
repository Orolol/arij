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
  /** Preview page from `GET .../sessions/:id`; the rest is fetched on demand. */
  seed: SessionStreamSeed | null;
  /** True when the route could not read the stream at all. */
  unavailable?: boolean;
  /** While the session runs, the stream tails itself from its own cursor. */
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
  // Read into plain strings so `loadMore` depends on the two messages rather
  // than on the translator identity, which changes on every render.
  const t = useTranslations("SessionLive");
  const unreadableCopy = errorMessages?.unreadable ?? t("log.streamUnreadable");
  const loadFailedCopy = errorMessages?.loadFailed ?? t("log.loadMoreFailed");
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

  // Capture a preview once per identity. A poll can replace the seed object
  // without discarding pages already loaded from this stream.
  const [identity, setIdentity] = useState({ key, seed });
  if (identity.key !== key) {
    setIdentity({ key, seed });
    setChunks(seed?.chunks ?? []);
    setHasMore(seed?.hasMore ?? false);
    setError(null);
    setLoading(false);
  }
  useEffect(() => {
    cursor.current = identity.seed?.nextAfter ?? null;
    cursorOffset.current = identity.seed?.nextOffset ?? 0;
  }, [identity]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const page = await fetchSessionChunkPage(projectId, sessionId, streamType, {
        after: cursor.current,
        offset: cursorOffset.current,
        signal,
      });
      if (signal.aborted) return;
      cursor.current = page.nextAfter;
      cursorOffset.current = page.nextOffset ?? 0;
      setHasMore(page.hasMore);
      setError(
        page.chunkStreamsUnavailable ? unreadableCopy : null
      );
      if (Array.isArray(page.chunks) && page.chunks.length > 0) {
        setChunks((current) => [...current, ...page.chunks]);
      }
    } catch {
      if (!signal.aborted) setError(loadFailedCopy);
    }
    if (!signal.aborted) setLoading(false);
  }, [projectId, sessionId, streamType, unreadableCopy, loadFailedCopy]);

  // The final read matters for responses that are only written at completion.
  const loadMore = useSessionPolling(key, load, isRunning, 3000, { enabled: !unavailable });

  /**
   * Chunks that are on screen only in part.
   *
   * Counted per CHUNK, not per slice — one 8.3 MB chunk walked out over five
   * pages is one oversized chunk, not five — and a chunk whose slices have
   * reached its end no longer counts at all: after "Load more" has walked it
   * out, the pane really is showing all of it. `countCharacters` counts code
   * points, because `contentLength` comes from SQLite `length()` and a JS
   * `.length` over-counts anything astral — agent output carries emoji
   * routinely.
   */
  const truncatedCount = (() => {
    const reachBySequence = new Map<number, { reach: number; length: number }>();
    for (const chunk of chunks) {
      if (!chunk.contentTruncated && chunk.contentOffset === 0) continue;
      const reach = chunk.contentOffset + countCharacters(chunk.content);
      const seen = reachBySequence.get(chunk.sequence);
      reachBySequence.set(chunk.sequence, {
        reach: Math.max(reach, seen?.reach ?? 0),
        length: chunk.contentLength,
      });
    }
    let count = 0;
    for (const { reach, length } of reachBySequence.values()) {
      if (reach < length) count += 1;
    }
    return count;
  })();

  return { chunks, hasMore, loading, error, truncatedCount, loadMore };
}
