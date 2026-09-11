"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, FileJson, Pause } from "lucide-react";

import {
  BandHeader,
  Mono,
  PillButton,
  ProgressTrack,
  SegmentedControl,
  StrataBand,
  SurfaceCard,
} from "@/components/piscine";
import { SessionOutputStream } from "@/components/sessions/SessionOutputStream";
import {
  fetchSessionLogs,
  type SessionLogsResponse,
} from "@/lib/agent-sessions/session-detail";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { cn } from "@/lib/utils";

import { SessionLogTail } from "./SessionLogTail";
import type { SessionDetail } from "./types";

/**
 * LIVE LOG — the band the whole screen is built around, and the only one that
 * grows into the column's leftover height.
 *
 * Everything the frame draws is here: the label on its turquoise underline,
 * the mono meta, the tail toggle, the white terminal card and the crawling
 * indeterminate bar under it. Two things the frame does not draw are here too,
 * both deliberate and both documented in the packet brief:
 *
 * 1. `tail off` — the frame only ever shows the on-state.
 * 2. A `Log | Response` segmented control, shown ONLY when the session is
 *    finished AND a final result exists. Frame 8a has nowhere for the
 *    response, and silently dropping a shipped feature is worse than one
 *    extra control on a screen the frame draws for a RUNNING session — where
 *    this control does not appear at all.
 *
 * The final result is the `response` stream, or — when a run wrote none —
 * its `output` stream. That fallback is most of the history: on the live
 * database the 1,288 claude-code sessions have no response chunk (and no raw
 * one), and 1,181 of them carry the whole final text as `output`
 * (`result-<id>`). Same order as the spec page's reading of an update.
 *
 * `logs.json` is not on the polled payload. A finished session with no raw
 * chunks shows its stored last line and reads the file on demand
 * (`?include=logs`), once, when the reader asks.
 */

type LogPane = "log" | "response";

/**
 * A MODULE-SCOPE COPY TABLE, so it holds catalogue KEY REFERENCES and the band
 * resolves them at render (`lib/i18n/catalogue.ts`, pattern 3).
 */
const PANE_OPTIONS: ReadonlyArray<{ value: LogPane; labelKey: TranslationKey }> = [
  { value: "log", labelKey: "SessionLive.log.paneLog" },
  { value: "response", labelKey: "SessionLive.log.paneResponse" },
];

export interface LiveLogBandProps {
  projectId: string;
  sessionId: string;
  session: SessionDetail;
  /** `running` only; the band derives `queued` from the session itself. */
  isRunning: boolean;
  /** `${providerLabel}`, as the header derives it. */
  providerLabel: string;
}

/**
 * The tail toggle. No primitive covers it — it is a bare button with an icon
 * and a word.
 *
 * Its state is the ICON plus the WORD, and nothing else. It used to swap
 * `--strata-live-deep` for `--muted-foreground` between on and off, which is
 * colour encoding state — the one rule the system never bends. The colour now
 * stays the live ground's own deep in both states (colour = stratum), and the
 * arrow becomes a pause glyph when the tail is released.
 */
function TailToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("SessionLive");
  const Icon = on ? ArrowDown : Pause;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={cn(
        "flex items-center gap-[6px] border-0 bg-transparent p-0",
        "font-sans text-[12px] font-semibold leading-none outline-none",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
        "text-strata-live-deep",
      )}
    >
      <Icon width={12} height={12} aria-hidden="true" />
      {on ? t("log.tailOn") : t("log.tailOff")}
    </button>
  );
}

type LogsOnDemandState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "failed" }
  | ({ phase: "loaded" } & SessionLogsResponse);

/**
 * The fallback of a raw stream with no chunks. The stored last line stands in
 * straight away; `logs.json` — up to 14.8 MB on the live database, and the
 * only record of a pre-chunk-store session — is read on a click, once, and
 * never polled.
 */
function SessionLogsOnDemand({
  projectId,
  sessionId,
  lastNonEmptyText,
  hasLogsFile,
}: {
  projectId: string;
  sessionId: string;
  lastNonEmptyText: string | null;
  hasLogsFile: boolean;
}) {
  const t = useTranslations("SessionLive");
  const [state, setState] = useState<LogsOnDemandState>({ phase: "idle" });

  async function load() {
    setState({ phase: "loading" });
    try {
      const read = await fetchSessionLogs(projectId, sessionId);
      setState({ phase: "loaded", ...read });
    } catch {
      setState({ phase: "failed" });
    }
  }

  return (
    <div className="flex flex-col gap-[8px]">
      {lastNonEmptyText && state.phase !== "loaded" && (
        <Mono
          as="div"
          size={11.5}
          tone="muted"
          className="whitespace-pre-wrap break-words"
        >
          {lastNonEmptyText}
        </Mono>
      )}
      {hasLogsFile && state.phase !== "loaded" && (
        <PillButton
          variant="outline"
          outlineTone="neutral"
          size="sm"
          icon={FileJson}
          onClick={load}
          pending={state.phase === "loading"}
          pendingLabel={t("log.logsLoading")}
          className="self-start"
          data-testid="session-logs-on-demand"
        >
          {t("log.logsOnDemand")}
        </PillButton>
      )}
      {state.phase === "failed" && (
        <Mono size={11} tone="danger">
          {t("log.logsLoadFailed")}
        </Mono>
      )}
      {/* Three distinct states, kept distinct: "no logs", "logs too large to
          serve here" and "the logs file is unreadable" used to collapse into
          one silent null. 11px, not 10.5: full sentences of prose. */}
      {state.phase === "loaded" && state.logsUnavailable && (
        <Mono size={11} tone="danger">
          {t("log.logsUnavailable")}
        </Mono>
      )}
      {state.phase === "loaded" && state.logsTruncated && (
        <Mono size={11} tone="live-mid">
          {t("log.logsTruncated")}
        </Mono>
      )}
      {state.phase === "loaded" && state.logs !== null && (
        <Mono
          as="div"
          size={11.5}
          tone="muted"
          className="whitespace-pre-wrap break-words"
        >
          {JSON.stringify(state.logs, null, 2)}
        </Mono>
      )}
      {state.phase === "loaded" &&
        state.logs === null &&
        !state.logsTruncated &&
        !state.logsUnavailable && (
          <Mono size={11.5} tone="muted">
            {t("log.logsEmpty")}
          </Mono>
        )}
    </div>
  );
}

export function LiveLogBand({
  projectId,
  sessionId,
  session,
  isRunning,
  providerLabel,
}: LiveLogBandProps) {
  const t = useTranslations("SessionLive");
  // Namespace-less, for the pane table's KEY REFERENCES.
  const tKey = useTranslations();
  const [tailOn, setTailOn] = useState(true);
  const [pinKey, setPinKey] = useState(0);
  // Null until the reader picks a pane; the default depends on what exists.
  const [pane, setPane] = useState<LogPane | null>(null);

  const releaseTail = useCallback(() => setTailOn(false), []);

  function reTail() {
    setTailOn(true);
    // Bumped so a second click still re-pins even when the tail never broke.
    setPinKey((key) => key + 1);
  }

  // Live = still able to write. A queued session has not started, but it
  // will on its own: its log waits for output and follows it when it comes,
  // and nothing on it points at a logs.json that does not exist yet.
  const live = isRunning || session.status === "queued";

  const responseSeed = session.chunkStreams?.response ?? null;
  const outputSeed = session.chunkStreams?.output ?? null;
  const responseHasChunks = (responseSeed?.chunks?.length ?? 0) > 0;
  const outputHasChunks = (outputSeed?.chunks?.length ?? 0) > 0;
  const resultStream = responseHasChunks ? "response" : "output";
  const resultSeed = responseHasChunks ? responseSeed : outputSeed;
  const hasResult = responseHasChunks || outputHasChunks;
  const rawIsEmpty = (session.chunkStreams?.raw?.chunks?.length ?? 0) === 0;
  // A RUNNING session shows exactly what the frame draws: label, meta, tail
  // toggle, nothing else. The result only exists once the run is over.
  const showPanes = !live && hasResult;
  // With no raw output at all, the log pane holds one stored line at most;
  // the result is the useful thing to open on.
  const defaultPane: LogPane = rawIsEmpty ? "response" : "log";
  const activePane: LogPane = showPanes ? (pane ?? defaultPane) : "log";

  // Two explicit calls, never `t(condition ? a : b)`: the key has to be a
  // literal at the call site for the coverage gate and the typed `t` to see it.
  const metaValues = { provider: providerLabel, id: session.id.slice(0, 6) };
  const meta =
    tailOn && activePane === "log"
      ? t("log.metaTailing", metaValues)
      : t("log.meta", metaValues);

  return (
    <StrataBand stratum="live" density="full" gap={9} grow>
      <BandHeader
        label={t("log.label")}
        stratum="live"
        labelSize={12}
        meta={meta}
        right={
          <div className="flex items-center gap-[12px]">
            {showPanes && (
              <SegmentedControl
                options={PANE_OPTIONS.map(({ value, labelKey }) => ({
                  value,
                  label: tKey(labelKey),
                }))}
                value={activePane}
                onChange={setPane}
                chrome="filled"
                size="sm"
                className="[--segment-inactive:var(--strata-live-mid)]"
              />
            )}
            {activePane === "log" && (
              <TailToggle on={tailOn} onToggle={reTail} />
            )}
          </div>
        }
      />

      {activePane === "log" ? (
        <SessionLogTail
          projectId={projectId}
          sessionId={sessionId}
          seed={session.chunkStreams?.raw ?? null}
          unavailable={session.chunkStreamsUnavailable}
          isRunning={live}
          startedAt={session.startedAt ?? null}
          // A finished session with no raw chunks: its stored last line, and
          // logs.json when the reader asks. A live session is still writing
          // (or about to) — it waits for its chunks, and its logs.json does
          // not exist yet even though the row already names its path.
          logsFallback={
            live || (!session.lastNonEmptyText && !session.logsPath) ? null : (
              <SessionLogsOnDemand
                projectId={projectId}
                sessionId={sessionId}
                lastNonEmptyText={session.lastNonEmptyText ?? null}
                hasLogsFile={Boolean(session.logsPath)}
              />
            )
          }
          tailOn={tailOn}
          pinKey={pinKey}
          onTailBreak={releaseTail}
        />
      ) : (
        <SurfaceCard
          radius={10}
          className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[13px]"
        >
          <SessionOutputStream
            projectId={projectId}
            sessionId={sessionId}
            streamType={resultStream}
            seed={resultSeed}
            unavailable={session.chunkStreamsUnavailable}
            isRunning={false}
            waitingLabel={t("log.waitingResponse")}
            emptyLabel={t("log.responseEmpty")}
          />
        </SurfaceCard>
      )}

      {/* Motion is the liveness signal; a finished session gets no crawl. */}
      {isRunning && <ProgressTrack height={4} />}
    </StrataBand>
  );
}
