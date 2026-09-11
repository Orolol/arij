"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { usePolling } from "@/hooks/usePolling";
import { PROVIDER_LABELS } from "@/lib/agent-config/constants";
import {
  fetchSessionArijActions,
  fetchSessionLogs,
} from "@/lib/agent-sessions/session-detail";
import type { ArijActionItem } from "@/components/shared/ArijActionsList";
import { LiveSessionScreen } from "@/components/session-live/LiveSessionScreen";
import { deriveTypeLabel } from "@/components/session-live/SessionHeaderBar";
import type { SessionDetail } from "@/components/session-live/types";

/**
 * Frame 8a — the live session.
 *
 * All of the page's BEHAVIOUR lives here, so the whole behavioural diff is
 * reviewable in one file; `<LiveSessionScreen>` owns the layout. Three things
 * in here look like ordinary code and are not — each closed a measured stall
 * or a shipped bug, and each is commented where it sits:
 *
 * 1. The Arij-actions scan is its OWN request (`loadSession`, below).
 * 2. The prompt is LAZY (`loadPrompt`, below), and so is `logs.json`
 *    (`handleExportLogs`): neither rides the polled payload.
 * 3. Polling runs only while the session is running or queued, with one last
 *    read at the transition (below). A finished session left open used to
 *    re-read the detail route and the actions scan every 3 seconds forever.
 *    The polls leave the stream previews out (`?omit=streams`) once the
 *    pagers have a seed: the pagers ignore every later one.
 */

/** One read of the detail route, as the page needs to tell it apart. */
type DetailRead =
  | { kind: "found"; session: SessionDetail }
  | { kind: "missing" }
  | { kind: "failed" };
export default function SessionDetailPage() {
  const t = useTranslations("SessionLive");
  // Namespace-less, for the KEY REFERENCES `session-live/labels.ts` holds.
  const tKey = useTranslations();
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const sessionId = params.sessionId as string;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  /** The route answered 404: nothing to poll for, ever. */
  const [notFound, setNotFound] = useState(false);
  /**
   * The session as last applied, for the poll to decide whether it still
   * needs stream previews — a ref, so the poll's identity (and with it the
   * interval) does not change on every read.
   */
  const held = useRef<SessionDetail | null>(null);
  const [distilling, setDistilling] = useState(false);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [exportLogsError, setExportLogsError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptState, setPromptState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  /**
   * Arij actions, once the raw-stream scan has run. Null until then, so the
   * list falls back to the durable half the detail payload already carries.
   */
  const [arijActions, setArijActions] = useState<ArijActionItem[] | null>(null);

  /**
   * One read of the detail payload — no state touched, and it never
   * rejects: a dropped connection is a `failed` read, which leaves the
   * screen on what it last showed.
   */
  const fetchDetail = useCallback(
    ({ streams }: { streams: boolean }): Promise<DetailRead> =>
      fetch(
        `/api/projects/${projectId}/sessions/${sessionId}${streams ? "" : "?omit=streams"}`
      )
        .then(async (res): Promise<DetailRead> => {
          if (res.status === 404) return { kind: "missing" };
          if (!res.ok) return { kind: "failed" };
          const data = await res.json();
          return data?.data
            ? { kind: "found", session: data.data as SessionDetail }
            : { kind: "failed" };
        })
        .catch((): DetailRead => ({ kind: "failed" })),
    [projectId, sessionId]
  );

  const applyDetail = useCallback(async (read: DetailRead) => {
    if (read.kind === "missing") {
      setNotFound(true);
      setLoading(false);
      return;
    }
    if (read.kind === "failed") return;

    // A read without previews keeps the ones already held: the band below
    // reads its seeds (and whether a result exists) from them.
    const previous = held.current;
    const next: SessionDetail =
      read.session.chunkStreams === undefined && previous
        ? {
            ...read.session,
            chunkStreams: previous.chunkStreams,
            ...(previous.chunkStreamsUnavailable
              ? { chunkStreamsUnavailable: true }
              : {}),
          }
        : read.session;
    held.current = next;
    setSession(next);
    setLoading(false);

    // The chunk-derived half of the actions list is its own request: finding
    // it means scanning the raw stream, which is 113 MB for the worst session
    // on the live database and would stall the shared connection on every
    // 3-second poll if it rode along with the payload above. The scan resumes
    // where it left off server-side, so after the first pass a poll only
    // covers what the session appended since.
    const actions = await fetchSessionArijActions(projectId, sessionId, {
      onPage: (page) => setArijActions(page.actions),
    }).catch(() => null);
    if (actions) setArijActions(actions);
  }, [projectId, sessionId]);

  /**
   * The poll. Previews only while the raw stream has not seeded anything
   * yet (first read, a queued session, a run that has not written): that is
   * when a pager can still take a seed.
   */
  const loadSession = useCallback(async () => {
    const needsStreams = (held.current?.chunkStreams?.raw?.chunks?.length ?? 0) === 0;
    await applyDetail(await fetchDetail({ streams: needsStreams }));
  }, [fetchDetail, applyDetail]);

  /** The Refresh button: a full read, previews included. */
  const refreshSession = useCallback(async () => {
    await applyDetail(await fetchDetail({ streams: true }));
  }, [fetchDetail, applyDetail]);

  /**
   * The prompt is up to 1.8 MB on the live database and is only ever looked
   * at in the prompt pane, so the route leaves it out unless it is asked for.
   * Fetched once, on the first open of that pane — never on mount, never on
   * the 3s poll.
   */
  const loadPrompt = useCallback(async () => {
    setPromptState((current) => (current === "idle" || current === "error" ? "loading" : current));
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sessions/${sessionId}?include=prompt`
      );
      // Not a `throw` into the catch below: a `throw` inside `try/catch` is a
      // construct the React Compiler stops on, and stopping left this page
      // unread by every compiler rule.
      if (!res.ok) {
        setPromptState("error");
      } else {
        const data = await res.json();
        setPrompt(data.data?.prompt ?? null);
        setPromptState("loaded");
      }
    } catch {
      setPromptState("error");
    }
  }, [projectId, sessionId]);

  function handleTogglePrompt() {
    setPromptOpen((open) => !open);
    if (promptState === "idle") void loadPrompt();
  }

  // The first read, then a poll only while the run can still change. `queued`
  // counts: a queued session starts without the user doing anything. The
  // Refresh button covers a finished one.
  const live = session?.status === "running" || session?.status === "queued";
  // Not loaded yet (or the last read failed before anything was shown):
  // keep asking. A 404 is an answer, not a transient failure.
  usePolling(loadSession, 3000, (!session && !notFound) || live);

  // One last read when a run the page SAW live stops: the poll that noticed
  // the new status may have raced the end of the run's own writes (cost,
  // tokens, the actions it posted last). Not on first paint — a session that
  // was already finished when the page opened needs only the one read.
  const wasLive = useRef(false);
  useEffect(() => {
    const ended = wasLive.current && !live;
    wasLive.current = live;
    if (!ended) return;
    // The state lands when the read answers, not in the effect body. With
    // previews: the Response pane mounts now, seeded from this read.
    void fetchDetail({ streams: true })
      .then(applyDetail)
      .catch(() => {});
  }, [live, fetchDetail, applyDetail]);

  async function handleCancel() {
    setStopping(true);
    setStopError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      // The route answers 409 on a session-lifecycle conflict and 404 when
      // neither the row nor an ephemeral activity-registry entry matches.
      // Surface it rather than silently reloading into the same state.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStopError(data.error || "Could not stop this session.");
      }
    } catch {
      setStopError("Could not stop this session.");
    }
    // Trailing, not in a `finally` clause (the compiler stops at one).
    setStopping(false);
    loadSession();
  }

  async function handleDistill() {
    setDistilling(true);
    setDistillError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memory/distill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSessionId: sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDistillError(data.error || "Failed to start memory distillation.");
      } else {
        const distillSessionId = data.data?.sessionId;
        if (distillSessionId) {
          router.push(`/projects/${projectId}/sessions/${distillSessionId}`);
        }
      }
    } catch {
      setDistillError("Failed to start memory distillation.");
    }
    setDistilling(false);
  }

  /**
   * `logs.json` is read here, on the click, with `?include=logs` — never on
   * the poll. The route serves it under its caps; a file too large or
   * unreadable comes back as null with a flag, and the reason is said rather
   * than downloading an empty file.
   */
  async function handleExportLogs() {
    setExportingLogs(true);
    setExportLogsError(null);
    // `.catch` rather than try/catch: the compiler reads this page, see
    // `loadPrompt` above.
    const read = await fetchSessionLogs(projectId, sessionId).catch(() => null);
    setExportingLogs(false);
    if (!read) {
      setExportLogsError(t("info.exportLogsFailed"));
      return;
    }
    if (read.logs === null) {
      if (read.logsTruncated) setExportLogsError(t("info.exportLogsTooLarge"));
      else if (read.logsUnavailable) setExportLogsError(t("info.exportLogsUnreadable"));
      else setExportLogsError(t("info.exportLogsMissing"));
      return;
    }
    const blob = new Blob([JSON.stringify(read.logs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId}-logs.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (notFound) {
    return (
      <div className="p-6 text-muted-foreground">{t("page.notFound")}</div>
    );
  }

  if (loading || !session) {
    return (
      <div className="p-6 text-muted-foreground">{t("page.loading")}</div>
    );
  }

  const isRunning = session.status === "running";
  const providerLabel =
    session.namedAgentName ||
    (session.provider
      ? (PROVIDER_LABELS[session.provider as keyof typeof PROVIDER_LABELS] ??
        session.provider)
      : t("page.agentFallback"));
  const { labelKey: typeLabelKey, fallback: typeFallback } =
    deriveTypeLabel(session);
  const typeLabel = typeLabelKey ? tKey(typeLabelKey) : typeFallback;

  return (
    <LiveSessionScreen
      projectId={projectId}
      sessionId={sessionId}
      session={session}
      isRunning={isRunning}
      providerLabel={providerLabel}
      typeLabel={typeLabel}
      arijActions={arijActions}
      onStop={handleCancel}
      stopping={stopping}
      stopError={stopError}
      onRefresh={refreshSession}
      onExportLogs={handleExportLogs}
      exportingLogs={exportingLogs}
      exportLogsError={exportLogsError}
      onDistill={handleDistill}
      distilling={distilling}
      distillError={distillError}
      promptOpen={promptOpen}
      onTogglePrompt={handleTogglePrompt}
      prompt={prompt}
      promptState={promptState}
      onRetryPrompt={loadPrompt}
    />
  );
}
