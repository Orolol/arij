"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";

import {
  DiffDelta,
  Mono,
  PillButton,
  SurfaceCard,
  TimelineLine,
} from "@/components/piscine";
import type { SessionStreamSeed } from "./useSessionStreamPager";
import {
  isChunkElisionMarker,
  isRawStreamTrimMarker,
} from "@/lib/agent-sessions/chunk-cap";
import { isChunkPruneMarker } from "@/lib/agent-sessions/chunk-retention";

import {
  classifyLogLine,
  elapsedStamp,
  splitInlineDelta,
  type LogLineKind,
} from "./log-lines";
import { useSessionStreamPager } from "./useSessionStreamPager";

/**
 * The terminal card of the LIVE LOG band — the screen's only real scroller.
 *
 * It reads the `raw` stream, and only `raw`: that is the one stream written
 * incrementally as the process emits (`lib/providers/base-provider.ts`, one
 * chunk per emission with `chunkKey: "<source>:<index>"`). `output` and
 * `response` are each a single final chunk written once at the end
 * (`"final-output"` / `"final-response"`), so neither of them streams. The old
 * page hid `raw` in a third tab; here the raw stream IS the screen.
 *
 * It opens on the END of that stream — the detail route seeds `raw` with its
 * last chunks — and "Load earlier output" walks back towards the head. While
 * the session runs, new output is appended from the tail's cursor.
 */

export interface SessionLogTailProps {
  projectId: string;
  sessionId: string;
  seed: SessionStreamSeed | null;
  unavailable?: boolean;
  isRunning: boolean;
  /** The session's ISO start, against which each chunk's mm:ss is measured. */
  startedAt: string | null;
  /**
   * Shown when the stream has no chunks at all — pre-chunk-store sessions,
   * whose text only exists in `logs.json`, read on demand by the band.
   */
  logsFallback?: React.ReactNode;
  /** While on, every append re-pins the scroll to the bottom. */
  tailOn: boolean;
  /** Bumped by the tail toggle to force a re-pin even when `tailOn` was true. */
  pinKey: number;
  /** The reader scrolled away from the bottom; the band releases the tail. */
  onTailBreak: () => void;
}

/** How far off the bottom counts as "the reader has taken over". */
const TAIL_RELEASE_PX = 24;

/** The scroll position to restore around a prepend, pinned on one line. */
interface PrependHold {
  /** Key of the first line when the earlier page was asked for. */
  firstKey: string | undefined;
  /** That line's element — React keeps it across the prepend. */
  anchor: Element | null;
  /** Its distance from the top of the scroller's viewport, then. */
  offset: number;
}

function offsetInScroller(anchor: Element, scroller: Element): number {
  return anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

interface RenderLine {
  key: string;
  text: string;
  /** Only the FIRST line of a chunk carries one — see below. */
  stamp: string | null;
}

/**
 * The counts at the end of a log line, spaced by their own inline-flex.
 * `DiffDelta` is `display:contents` so that the row's gap spaces the two
 * numerals; inside a sentence there is no row gap, so one is supplied here.
 */
function InlineDelta({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;
  return (
    <span className="ml-[5px] inline-flex items-baseline gap-[5px]">
      <DiffDelta added={added} removed={removed} size={11.5} />
    </span>
  );
}

export function SessionLogTail({
  projectId,
  sessionId,
  seed,
  unavailable = false,
  isRunning,
  startedAt,
  logsFallback,
  tailOn,
  pinKey,
  onTailBreak,
}: SessionLogTailProps) {
  const t = useTranslations("SessionLive");
  const {
    chunks,
    hasMore,
    loading,
    error,
    truncatedCount,
    loadMore,
    hasEarlier,
    loadingEarlier,
    loadEarlier,
  } = useSessionStreamPager({
    projectId,
    sessionId,
    streamType: "raw",
    seed,
    unavailable,
    isRunning,
  });

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  /**
   * Distance from the bottom to hold across a prepend. Earlier output lands
   * ABOVE what the reader is looking at; without this the lines under their
   * eyes would jump down by the height of the new page.
   */
  const prependHold = useRef<PrependHold | null>(null);

  /**
   * One row per line of output.
   *
   * TIMESTAMPS ARE PER CHUNK, NOT PER LINE. `agent_session_chunks.created_at`
   * is the only time this data has; nothing stores when an individual line was
   * written. So the FIRST line of each chunk carries the chunk's mm:ss and the
   * rest of that chunk carries none — inventing a time per line would be a
   * fabrication, and repeating the chunk's time down every line would be a
   * different one.
   */
  const lines = useMemo<RenderLine[]>(() => {
    const out: RenderLine[] = [];
    for (const chunk of chunks) {
      const parts = chunk.content.split("\n");
      // A chunk that ends in a newline would otherwise draw a blank last row.
      if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
      const stamp = elapsedStamp(startedAt, chunk.createdAt ?? null);
      parts.forEach((text, index) => {
        out.push({
          key: `${chunk.id}:${chunk.contentOffset}:${index}`,
          text,
          stamp: index === 0 ? stamp : null,
        });
      });
    }
    return out;
  }, [chunks, startedAt]);

  async function handleLoadEarlier() {
    const element = scroller.current;
    const anchor = content.current?.firstElementChild ?? null;
    prependHold.current = element
      ? {
          firstKey: lines[0]?.key,
          anchor,
          offset: anchor ? offsetInScroller(anchor, element) : 0,
        }
      : null;
    // Reading back is not following the end: release the tail so the pin
    // does not yank the view back down past the page just loaded.
    onTailBreak();
    const prepended = await loadEarlier();
    // Nothing is coming (empty, unreadable or failed page): a hold left in
    // place would be spent on the next unrelated change of the lines — a
    // live append seconds later — and jump the view.
    if (prepended === 0) prependHold.current = null;
  }

  /**
   * Tailing: pin to the bottom and STAY there.
   *
   * A one-shot `scrollTop = scrollHeight` in a render effect is not enough —
   * it runs before the flex column has settled its final height, so the
   * browser clamps the assignment to zero and the first paint of a long log
   * opens at the TOP. A ResizeObserver on the content re-pins after every
   * layout change: the settling first paint, a late web font, and every
   * appended chunk. Programmatic scrolling does not trip the release check
   * below, because it lands at distance 0.
   */
  useEffect(() => {
    if (!tailOn) return;
    const element = scroller.current;
    const inner = content.current;
    if (!element) return;

    const pin = () => {
      element.scrollTop = element.scrollHeight;
    };
    pin();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(pin);
    observer.observe(element);
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, [tailOn, pinKey]);

  /**
   * Keep the line the reader was on where it was once earlier output lands
   * above it. Measured on that line, not as a distance from the bottom: an
   * append can land in the same render (a live session keeps writing), and
   * a bottom-relative hold would then shift the view by the appended height.
   * Spent only by the render where the first line actually changed — an
   * append that lands while the earlier page is still out leaves it alone.
   */
  useLayoutEffect(() => {
    const element = scroller.current;
    const hold = prependHold.current;
    if (!element || !hold) return;
    if (lines[0]?.key === hold.firstKey) return;
    prependHold.current = null;
    if (!hold.anchor || !hold.anchor.isConnected) return;
    element.scrollTop += offsetInScroller(hold.anchor, element) - hold.offset;
  }, [lines]);

  function handleScroll() {
    if (!tailOn) return;
    const element = scroller.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance > TAIL_RELEASE_PX) onTailBreak();
  }

  const body = (() => {
    if (unavailable) {
      return (
        <span data-testid="stream-unavailable-raw">
          {/* Verbatim, from the sentence the old Raw Logs tab showed. */}
          <Mono size={11.5} tone="danger">
            {t("log.rawUnavailable")}
          </Mono>
        </span>
      );
    }

    if (lines.length === 0) {
      if (logsFallback) return <>{logsFallback}</>;
      return (
        <Mono size={11.5} tone="muted">
          {isRunning ? t("log.waitingOutput") : t("log.logsEmpty")}
        </Mono>
      );
    }

    return lines.map((line, index) => {
      // Arij's own voice, not the agent's: the write-path cap dropped the
      // middle of this chunk, or data retention dropped the head of this
      // stream. Rendered in the live stratum's mid tone rather than the dim
      // `plain` every other unrecognised line gets — read as muted mono it
      // disappears into the output it is reporting on. Colour here is the
      // band's own stratum, not a state.
      // The write-path cap on the whole raw stream (`raw-trimmed`) is the
      // same voice: reading from the end walks back into it.
      const markerTestId = isChunkPruneMarker(line.text)
        ? "chunk-prune-marker"
        : isChunkElisionMarker(line.text)
          ? "chunk-elision-marker"
          : isRawStreamTrimMarker(line.text)
            ? "raw-trim-marker"
            : null;
      if (markerTestId) {
        return (
          <span key={line.key} data-testid={markerTestId}>
            <Mono size={11.5} tone="live-mid">
              {line.stamp ? `${line.stamp} ` : ""}
              {line.text}
            </Mono>
          </span>
        );
      }

      const { kind, body: text } = classifyLogLine(line.text);
      // The trailing row of a running session IS the running line, whatever
      // its glyph would otherwise have been. That is the frame's last row.
      const effective: LogLineKind =
        isRunning && index === lines.length - 1 ? "live" : kind;
      const delta = splitInlineDelta(text);

      if (effective === "plain") {
        return (
          <Mono key={line.key} size={11.5} tone="muted">
            {line.stamp ? `${line.stamp} ` : ""}
            {delta.text}
            <InlineDelta added={delta.added} removed={delta.removed} />
          </Mono>
        );
      }

      return (
        <TimelineLine
          key={line.key}
          kind={effective}
          size={11.5}
          timestamp={line.stamp ?? undefined}
        >
          {delta.text}
          <InlineDelta added={delta.added} removed={delta.removed} />
        </TimelineLine>
      );
    });
  })();

  return (
    <div
      data-testid="stream-raw"
      className="flex min-h-0 flex-1 flex-col"
    >
      <SurfaceCard
        radius={10}
        className="flex min-h-0 flex-1 flex-col gap-[8px] px-[16px] py-[13px]"
      >
        {hasEarlier && (
          <PillButton
            variant="outline"
            outlineTone="neutral"
            size="sm"
            onClick={handleLoadEarlier}
            disabled={loadingEarlier}
            className="self-start"
            data-testid="stream-load-earlier-raw"
          >
            {loadingEarlier ? t("log.loadingMore") : t("log.loadEarlier")}
          </PillButton>
        )}
        {truncatedCount > 0 && (
          <span data-testid="stream-truncated-raw">
            <Mono size={10.5} tone="live-mid">
              {t("log.truncated", { count: truncatedCount })}
              {hasMore
                ? t("log.truncatedLoadMore")
                : hasEarlier
                  ? t("log.truncatedLoadEarlier")
                  : ""}
            </Mono>
          </span>
        )}
        {error && (
          <Mono size={10.5} tone="danger">
            {error}
          </Mono>
        )}
        {/*
          Bottom-anchored WITHOUT `justify-content: flex-end` on the scroller
          itself: a column flex container that is both `justify-end` and
          `overflow-y:auto` makes its overflowing top unreachable in Chrome.
          A `min-h-full` inner column with `justify-end` pins short output to
          the bottom and scrolls normally once it is long.
        */}
        <div
          ref={scroller}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div
            ref={content}
            className="flex min-h-full flex-col justify-end gap-[6px] break-words"
          >
            {body}
          </div>
        </div>
        {/* Below the log, where newer output goes: the seed is the end of the
            stream, so this only appears when a live follow fell a page
            behind. */}
        {hasMore && (
          <PillButton
            variant="outline"
            outlineTone="neutral"
            size="sm"
            onClick={loadMore}
            disabled={loading}
            className="self-start"
            data-testid="stream-load-more-raw"
          >
            {loading ? t("log.loadingMore") : t("log.loadMore")}
          </PillButton>
        )}
      </SurfaceCard>
    </div>
  );
}
