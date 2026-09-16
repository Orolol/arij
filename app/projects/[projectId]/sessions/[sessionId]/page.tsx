"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useSessionPolling } from "@/components/session-live/useSessionPolling";
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
 * Metadata and the expensive action scan poll independently. The composed
 * prompt is fetched only when opened, and so is `logs.json`
 * (`handleExportLogs`): neither rides the polled payload.
 *
 * Both polls run only while the session is running or queued, and
 * `useSessionPolling` queues one last read at the transition. A finished
 * session left open used to re-read the detail route and the actions scan
 * every 3 seconds forever. The polls leave the stream previews out
 * (`?omit=streams`) once the raw pager has a seed: the pagers ignore every
 * later one — except the read that closes a run and the Refresh button,
 * which take them again so the Response pane mounts seeded.
 */

export default function SessionDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const sessionId = params.sessionId as string;
  return <SessionDetailContent key={`${projectId}:${sessionId}`} projectId={projectId} sessionId={sessionId} />;
}

function SessionDetailContent({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const t = useTranslations("SessionLive");
  // Namespace-less, for the KEY REFERENCES `session-live/labels.ts` holds.
  const tKey = useTranslations();
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * The session as last applied, for the poll to decide whether it still
   * needs stream previews — a ref, so the poll's identity (and with it the
   * interval) does not change on every read.
   */
  const held = useRef<SessionDetail | null>(null);
  /** The next read asks for the stream previews even if the raw one is seeded. */
  const streamsWanted = useRef(false);
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
  // True when the raw-stream scan failed: the list on screen is then the
  // durable half only, and saying so is the difference between a short list
  // and a lie.
  const [actionsUnavailable, setActionsUnavailable] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const promptPending = useRef(false);
  const mutationPending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const readFailed = t("page.loadFailed");
  const notFoundCopy = t("page.notFound");

  const readSession = useCallback(async (signal: AbortSignal) => {
    // Previews only while the raw stream has not seeded anything yet (first
    // read, a queued session, a run that has not written), or when a read
    // asked for them explicitly: that is when a pager can still take a seed.
    const withStreams =
      streamsWanted.current ||
      (held.current?.chunkStreams?.raw?.chunks?.length ?? 0) === 0;
    const url = `/api/projects/${projectId}/sessions/${sessionId}${withStreams ? "" : "?omit=streams"}`;
    let ok = false;
    let status = 0;
    let body: { data?: SessionDetail; error?: string } | null = null;
    try {
      const res = await fetch(url, { signal });
      ok = res.ok;
      status = res.status;
      body = await res.json();
    } catch {
      // Preserve the last good session and expose a retry when nothing loaded.
    }
    if (signal.aborted) return;
    if (ok && body?.data) {
      if (withStreams) streamsWanted.current = false;
      // A read without previews keeps the ones already held: the band below
      // reads its seeds (and whether a result exists) from them.
      const previous = held.current;
      const next: SessionDetail =
        body.data.chunkStreams === undefined && previous
          ? {
              ...body.data,
              chunkStreams: previous.chunkStreams,
              ...(previous.chunkStreamsUnavailable
                ? { chunkStreamsUnavailable: true }
                : {}),
            }
          : body.data;
      held.current = next;
      setSession(next);
      setLoadError(null);
    } else {
      // A 404 is an answer, not a transient failure: it is said in the
      // catalogue's words, and nothing polls it (the session is not live).
      setLoadError(
        status === 404
          ? notFoundCopy
          : typeof body?.error === "string"
            ? body.error
            : readFailed
      );
    }
    setLoading(false);
  }, [projectId, sessionId, readFailed, notFoundCopy]);

  const readActions = useCallback(async (signal: AbortSignal) => {
    // The chunk-derived half of the actions list is its own request: finding
    // it means scanning the raw stream, which is 113 MB for the worst session
    // on the live database and would stall the shared connection on every
    // 3-second poll if it rode along with the payload above. The scan resumes
    // where it left off server-side, so after the first pass a poll only
    // covers what the session appended since.
    try {
      const actions = await fetchSessionArijActions(projectId, sessionId, {
        signal,
        onPage: (page) => {
          if (signal.aborted) return;
          setArijActions(page.actions);
          setActionsUnavailable(page.arijActionsUnavailable === true);
        },
      });
      if (signal.aborted) return;
      if (actions) setArijActions(actions);
    } catch {
      // Keep the last scanned actions and the durable detail payload on failure.
    }
  }, [projectId, sessionId]);

  // The first read, then a poll only while the run can still change. `queued`
  // counts: a queued session starts without the user doing anything. The
  // Refresh button covers a finished one.
  const live = session?.status === "running" || session?.status === "queued";

  // The read that closes a run the page SAW live takes the previews again:
  // the Response pane mounts now, seeded from it. Declared before the polls
  // so the flag is set when their transition read goes out. Not on first
  // paint — a session already finished when the page opened needs only the
  // one read.
  const wasLive = useRef(false);
  useEffect(() => {
    if (wasLive.current && !live) streamsWanted.current = true;
    wasLive.current = live;
  }, [live]);

  const refreshSession = useSessionPolling(`${projectId}:${sessionId}`, readSession, live, 3000, { immediate: true });
  const refreshActions = useSessionPolling(`${projectId}:${sessionId}:actions`, readActions, live, 3000, { immediate: true });
  const loadSession = useCallback(async () => {
    await Promise.all([refreshSession(), refreshActions()]);
  }, [refreshSession, refreshActions]);

  /** The Refresh button: a full read, previews included. */
  const handleRefresh = useCallback(async () => {
    streamsWanted.current = true;
    await loadSession();
  }, [loadSession]);

  /**
   * The prompt is up to 1.8 MB on the live database and is only ever looked
   * at in the prompt pane, so the route leaves it out unless it is asked for.
   * Fetched once, on the first open of that pane — never on mount, never on
   * the 3s poll.
   */
  const loadPrompt = useCallback(async () => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || promptPending.current) return;
    promptPending.current = true;
    setPromptState((current) => (current === "idle" || current === "error" ? "loading" : current));
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sessions/${sessionId}?include=prompt`, { signal },
      );
      if (signal.aborted) return;
      // Not a `throw` into the catch below: a `throw` inside `try/catch` is a
      // construct the React Compiler stops on, and stopping left this page
      // unread by every compiler rule.
      if (!res.ok) {
        setPromptState("error");
      } else {
        const data = await res.json();
        if (signal.aborted) return;
        setPrompt(data.data?.prompt ?? null);
        setPromptState("loaded");
      }
    } catch {
      if (!signal.aborted) setPromptState("error");
    }
    promptPending.current = false;
  }, [projectId, sessionId]);

  function handleTogglePrompt() {
    setPromptOpen((open) => !open);
    if (promptState === "idle") void loadPrompt();
  }

  async function handleCancel() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || mutationPending.current) return;
    mutationPending.current = true;
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
      if (signal.aborted) return;
      if (!res.ok) {
        setStopError(data.error || "Could not stop this session.");
      }
    } catch {
      if (signal.aborted) return;
      setStopError("Could not stop this session.");
    }
    // Trailing, not in a `finally` clause (the compiler stops at one).
    setStopping(false);
    mutationPending.current = false;
    void loadSession();
  }

  async function handleDistill() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || mutationPending.current) return;
    mutationPending.current = true;
    setDistilling(true);
    setDistillError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memory/distill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSessionId: sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (signal.aborted) return;
      if (!res.ok) {
        setDistillError(data.error || "Failed to start memory distillation.");
      } else {
        const distillSessionId = data.data?.sessionId;
        if (distillSessionId) {
          router.push(`/projects/${projectId}/sessions/${distillSessionId}`);
        }
      }
    } catch {
      if (signal.aborted) return;
      setDistillError("Failed to start memory distillation.");
    }
    setDistilling(false);
    mutationPending.current = false;
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

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">{t("page.loading")}</div>
    );
  }
  if (!session) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p role="alert" className="text-sm text-destructive">{loadError}</p>
        <button type="button" onClick={() => void loadSession()} className="text-sm underline">{t("page.retry")}</button>
      </div>
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
      arijActionsUnavailable={actionsUnavailable}
      providerLabel={providerLabel}
      typeLabel={typeLabel}
      arijActions={arijActions}
      onStop={handleCancel}
      stopping={stopping}
      stopError={stopError}
      onRefresh={handleRefresh}
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
