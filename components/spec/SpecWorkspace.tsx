"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import { PillButton } from "@/components/piscine";
import { DocsCard } from "@/components/spec/DocsCard";
import { MemoryPanel } from "@/components/spec/MemoryPanel";
import { PromptAnatomyBand } from "@/components/spec/PromptAnatomyBand";
import { SpecBand } from "@/components/spec/SpecBand";
import { SpecUpdateDialog } from "@/components/spec/SpecUpdateDialog";
import { SuggestionBand } from "@/components/spec/SuggestionBand";
import { fetchJson, requestJson } from "@/lib/api/client";
import { fetchSessionStream } from "@/lib/agent-sessions/session-detail";

interface SessionDetailResponse {
  status?: string;
  lastNonEmptyText?: string;
  error?: string;
}

/**
 * The agent's final answer: the LAST chunk of the session's `response` stream
 * (`final-response`), reassembled if a legacy oversized row came out in
 * slices. The detail route no longer serves `logs.json` on its polled
 * payload, and that file only ever held the same text. Null when the run
 * wrote no response, or the read failed — the caller falls back.
 */
async function readFinalResponse(
  projectId: string,
  sessionId: string
): Promise<string | null> {
  try {
    const { chunks } = await fetchSessionStream(projectId, sessionId, "response");
    const last = chunks[chunks.length - 1];
    if (!last) return null;
    const text = chunks
      .filter((chunk) => chunk.sequence === last.sequence)
      .map((chunk) => chunk.content)
      .join("");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

interface ProjectSpec { spec: string | null; updatedAt?: string | null }
function isProjectSpec(value: unknown): value is ProjectSpec {
  return typeof value === "object" && value !== null && "spec" in value
    && (value.spec === null || typeof value.spec === "string");
}

export function SpecWorkspace({ projectId, pollIntervalMs = 2000 }: { projectId: string; pollIntervalMs?: number }) {
  const t = useTranslations("Spec");
  const [spec, setSpec] = useState("");
  const [savedSpec, setSavedSpec] = useState("");
  const [specLoaded, setSpecLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const readSequence = useRef(0);
  const saveInFlight = useRef(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateSessionId, setUpdateSessionId] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    "running" | "done" | "failed" | null
  >(null);
  const [updateStream, setUpdateStream] = useState<string | null>(null);
  const [updateResponse, setUpdateResponse] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // The shared Edit/Preview tab: one control drives BOTH paired panels
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  const refreshSpec = useCallback(() => {
    if (!projectId) return Promise.resolve(false);
    const request = ++readSequence.current;
    return requestJson<ProjectSpec>(`/api/projects/${projectId}`, {
      errorMessage: t("page.loadFailed"), validateData: isProjectSpec,
    }).then((result) => {
      if (request !== readSequence.current) return false;
      setSpecError(result.error);
      if (!result.data) return false;
      const incoming = result.data.spec ?? "";
      setSpec(incoming);
      setSavedSpec(incoming);
      setSpecLoaded(true);
      setSavedAt(result.data.updatedAt ?? null);
      return true;
    });
  }, [projectId, t]);

  useEffect(() => {
    let active = true;
    void refreshSpec();
    if (projectId) {
      void fetch(`/api/projects/${projectId}/spec/update`)
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (active && payload?.data?.pending && payload.data.sessionId) {
            setUpdateSessionId(payload.data.sessionId);
            setUpdateStatus("running");
          }
        }).catch(() => {});
    }
    return () => { active = false; readSequence.current += 1; };
  }, [projectId, refreshSpec]);

  async function handleSave(): Promise<boolean> {
    if (!projectId || !specLoaded || updateStatus === "running" || saveInFlight.current) return false;
    saveInFlight.current = true;
    readSequence.current += 1;
    setSaving(true);
    setSpecError(null);
    const result = await requestJson<ProjectSpec>(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec }),
      errorMessage: t("page.saveFailed"), validateData: isProjectSpec,
    });
    saveInFlight.current = false;
    setSaving(false);
    setSpecError(result.error);
    if (!result.data) return false;
    const saved = result.data.spec ?? "";
    setSavedSpec(saved);
    // The editor stays writable during a save. Preserve newer keystrokes.
    setSpec((current) => current === spec ? saved : current);
    setSavedAt(result.data.updatedAt ?? new Date().toISOString());
    return true;
  }

  useEffect(() => {
    if (!updateSessionId || updateStatus !== "running" || !projectId) return;

    let cancelled = false;
    // The detail payload carries only a short preview of each stream now, and
    // it always starts from the beginning — so the live view keeps its own
    // cursor and appends, instead of re-reading the whole stream every 2s.
    let cursor: number | null = null;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let streamed = "";
    let lastChunk = "";

    const poll = async () => {
      const response = await fetchJson<{ data?: SessionDetailResponse; error?: string }>(
        `/api/projects/${projectId}/sessions/${updateSessionId}`,
      );
      if (cancelled) return;

      if (response?.status === 404) {
        setUpdateStatus("failed");
        setUpdateError(response.body?.error || t("page.sessionNotFound"));
        return;
      }
      // A transient status failure leaves the session running for the next tick.
      if (!response?.ok || !response.body?.data) return;
      const session = response.body.data;

      const page = await fetchSessionStream(
        projectId, updateSessionId, "output", { after: cursor, offset },
      ).catch(() => null);
      if (cancelled) return;
      // Keep the cursor on a failed stream read so the next tick retries its tail.
      if (page) {
        cursor = page.nextAfter;
        offset = page.nextOffset;
        if (page.chunks.length > 0) {
          streamed += page.chunks.map((chunk) => chunk.content).join("");
          lastChunk = page.chunks[page.chunks.length - 1].content;
          setUpdateStream(streamed);
        }
      }
      if (!streamed && session.lastNonEmptyText) setUpdateStream(session.lastNonEmptyText);

      if (session.status === "completed") {
        // Keep the editor locked until the saved result has been loaded.
        const loaded = await refreshSpec();
        if (cancelled || !loaded) return;
        const finalResponse = await readFinalResponse(projectId, updateSessionId);
        if (cancelled) return;
        setUpdateStatus("done");
        setUpdateResponse(finalResponse || lastChunk || session.lastNonEmptyText || null);
      } else if (session.status === "failed") {
        setUpdateStatus("failed");
        setUpdateError(session.error || t("page.sessionFailed"));
      }
    };

    // Schedule after completion: overlapping polls shared the same cursor and
    // appended the same chunks twice when a response took longer than a tick.
    const tick = async () => {
      await poll();
      if (!cancelled) timer = setTimeout(tick, pollIntervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [updateSessionId, updateStatus, projectId, refreshSpec, pollIntervalMs, t]);

  function handleUpdateStarted(data: { sessionId: string }) {
    setUpdateSessionId(data.sessionId);
    setUpdateStatus("running");
    setUpdateStream(null);
    setUpdateResponse(null);
    setUpdateError(null);
  }

  function handleUpdateDismissed() {
    setUpdateSessionId(null);
    setUpdateStatus(null);
    setUpdateStream(null);
    setUpdateResponse(null);
    setUpdateError(null);
  }

  async function handleBeforeUpdateStart() {
    if (spec !== savedSpec) return handleSave();
    return specLoaded;
  }

  /**
   * Frame 8b drew "Régénérer par chat" in the project's 60px header. That
   * header is gone (frame 13a — the global bar is the only one now), and with
   * it the `#project-header-actions` node `HeaderActionSlot` used to portal
   * into: the slot could never find a host again, so the portal was deleted and
   * the pill renders where the fallback already put it — the right end of the
   * SPEC band's own header row, which IS this screen's second row.
   */
  const regenerateAction = (
    <PillButton
      variant="filled"
      size="md"
      icon={Sparkles}
      data-testid="spec-update-button"
      onClick={() => setUpdateDialogOpen(true)}
      disabled={!specLoaded || saving || updateStatus === "running"}
    >
      {t("page.regenerate")}
    </PillButton>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-[12px] px-[14px] pb-[14px] max-[1099px]:h-auto max-[1099px]:overflow-y-auto">
      {specError && (
        <div role="alert" className="flex items-center gap-3 text-[13px] text-destructive">
          <span>{specError}</span>
          {!specLoaded && <PillButton variant="outline" onClick={() => void refreshSpec()}>{t("page.retry")}</PillButton>}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-[12px] max-[1099px]:flex-none max-[1099px]:flex-col">
        <SpecBand
          className="min-w-0 flex-[7]"
          projectId={projectId}
          spec={spec}
          onSpecChange={setSpec}
          tab={tab}
          onTabChange={setTab}
          loaded={specLoaded}
          savedSpec={savedSpec}
          savedAt={savedAt}
          saving={saving}
          updateRunning={updateStatus === "running"}
          onSave={() => void handleSave()}
          headerAction={regenerateAction}
        />

        <div className="flex min-w-0 flex-[3] flex-col gap-[12px]">
          {/* The one growing band on this screen. */}
          <MemoryPanel
            projectId={projectId}
            mode={tab}
            className="max-[1099px]:min-h-[320px] max-[1099px]:flex-none"
          />
          <SuggestionBand
            projectId={projectId}
            sessionId={updateSessionId}
            status={updateStatus}
            stream={updateStream}
            response={updateResponse}
            error={updateError}
            onDismiss={handleUpdateDismissed}
          />
          <DocsCard projectId={projectId} />
        </div>
      </div>

      {/*
        The 24px gap under the columns row is intentional: this band's own
        margin-top stacks with the wrapper's 12px gap. The anatomy is a
        different register from the three editable regions above it.
      */}
      <PromptAnatomyBand projectId={projectId} className="mt-[12px]" />

      <SpecUpdateDialog
        projectId={projectId}
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        onStarted={handleUpdateStarted}
        onBeforeStart={handleBeforeUpdateStart}
      />
    </div>
  );
}
