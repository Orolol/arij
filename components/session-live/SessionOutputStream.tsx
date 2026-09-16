"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { AgentSessionStreamType } from "@/lib/agent-sessions/chunks";
import { useSessionStreamPager, type SessionStreamSeed } from "./useSessionStreamPager";
import {
  chunkElisionMarkerSplitter,
  isChunkElisionMarker,
} from "@/lib/agent-sessions/chunk-cap";
import {
  chunkPruneMarkerSplitter,
  isChunkPruneMarker,
} from "@/lib/agent-sessions/chunk-retention";

export type { SessionStreamSeed } from "./useSessionStreamPager";

interface SessionOutputStreamProps {
  projectId: string;
  sessionId: string;
  streamType: AgentSessionStreamType;
  /** Preview page from `GET .../sessions/:id`; the rest is fetched on demand. */
  seed: SessionStreamSeed | null;
  /** True when the route could not read the stream at all. */
  unavailable?: boolean;
  /** Shown when the stream is empty — usually the session's logs.json text. */
  fallback?: React.ReactNode;
  /** While the session runs, the stream tails itself from its own cursor. */
  isRunning: boolean;
  emptyLabel: string;
  /**
   * Shown instead of `emptyLabel` while the session is still writing.
   * Defaults to the catalogue's `stream.waiting` when the caller omits it.
   */
  waitingLabel?: string;
}

/**
 * Split the stream's text around Arij's two elision markers — the write-path
 * cap's "the middle of this chunk is gone" and data retention's "the head of
 * this stream is gone" — and give each its own element, so Arij's own voice
 * reads as a notice rather than as one more dim line of agent output.
 *
 * Split, not a line-by-line map: a page carries up to a megabyte of text, and
 * one element per line would be thousands of nodes where the flat block needs
 * one. `String.split` with a capturing pattern interleaves the markers back
 * into the parts, so the surrounding text stays in whole runs. The two passes
 * nest rather than combine into one pattern: each marker's shape belongs to
 * the module that writes it, and neither owns the other's regexp source.
 */
function withElisionMarkers(text: string): React.ReactNode[] {
  return text.split(chunkElisionMarkerSplitter()).flatMap((part, index) =>
    isChunkElisionMarker(part)
      ? [
          <span
            key={`cap-${index}`}
            data-testid="chunk-elision-marker"
            className="text-strata-live-mid"
          >
            {part}
          </span>,
        ]
      : part.split(chunkPruneMarkerSplitter()).map((inner, innerIndex) =>
          isChunkPruneMarker(inner) ? (
            <span
              key={`prune-${index}-${innerIndex}`}
              data-testid="chunk-prune-marker"
              className="text-strata-live-mid"
            >
              {inner}
            </span>
          ) : (
            inner
          )
        )
  );
}

/**
 * One chunk stream, paged.
 *
 * The session detail route used to inline all three streams in full — 112 MB
 * for the worst session on the live database, read synchronously on the one
 * shared connection, so opening the page stalled every other request. Here
 * the page starts from the small preview the detail payload carried and walks
 * forward with `?stream=&after=`, one bounded page per click (or per poll
 * while the session is still writing).
 */
export function SessionOutputStream({
  projectId,
  sessionId,
  streamType,
  seed,
  unavailable = false,
  fallback,
  isRunning,
  emptyLabel,
  waitingLabel,
}: SessionOutputStreamProps) {
  const t = useTranslations("Sessions");
  const { chunks, hasMore, loading, error, truncatedCount, loadMore } = useSessionStreamPager({
    projectId, sessionId, streamType, seed, unavailable, isRunning,
    errorMessages: { unreadable: t("stream.unreadable"), loadFailed: t("stream.loadMoreError") },
  });

  if (unavailable) {
    return (
      <p className="text-[13px] text-destructive/90" data-testid={`stream-unavailable-${streamType}`}>
        {t("stream.unavailable", { stream: streamType })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-[10px]" data-testid={`stream-${streamType}`}>
      {chunks.length === 0 ? fallback || (
        <p className="text-[13px] text-muted-foreground">
          {isRunning ? waitingLabel ?? t("stream.waiting") : emptyLabel}
        </p>
      ) : (
      <div className="max-h-[500px] overflow-y-auto overflow-x-hidden font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap break-words text-muted-foreground">
        {withElisionMarkers(chunks.map((chunk) => chunk.content).join(""))}
      </div>
      )}
      {truncatedCount > 0 && (
        <p className="text-[11.5px] text-meta" data-testid={`stream-truncated-${streamType}`}>
          {t("stream.truncated", { count: truncatedCount })}
          {hasMore ? ` ${t("stream.loadMoreHint")}` : ""}
        </p>
      )}
      {error && <p className="text-[12px] text-destructive">{error}</p>}
      {(hasMore || error) && (
        <Button
          variant="outline"
          size="sm"
          className="h-[29px] w-fit rounded-[8px] px-[12px] text-[12.5px]"
          onClick={loadMore}
          disabled={loading}
          data-testid={`stream-load-more-${streamType}`}
        >
          {loading ? t("stream.loading") : t("stream.loadMore")}
        </Button>
      )}
    </div>
  );
}
