"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  CircleSlash,
  FileText,
  Moon,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  BandHeader,
  Mono,
  PillButton,
  QuietLink,
  StrataBand,
  SurfaceCard,
  type MonoTone,
} from "@/components/piscine";
import { SpecPreview } from "@/components/spec/SpecPreview";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import { PROJECT_MEMORY_MAX_TOKENS } from "@/lib/documents/memory-constants";
import { estimateTokens } from "@/lib/tokens/estimator";
import type {
  MemoryWriteProvenance,
  MemoryWriteSource,
} from "@/lib/documents/memory-provenance";
import type { MemoryEnvelope } from "@/lib/documents/memory-envelope";
import {
  DREAMING_MEMORY_SECTIONS,
  MEMORY_WRITER_AGENT_TYPES,
  isMemoryDiscardReason,
  type MemoryDiscardReason,
} from "@/lib/workflow/dreaming-constants";

export const DREAMING_MEMORY_TEMPLATE = DREAMING_MEMORY_SECTIONS.map(
  (title) => `## ${title}\n\n- `
).join("\n\n");

export function hasAllDreamingSections(markdown: string): boolean {
  return DREAMING_MEMORY_SECTIONS.every((section) =>
    new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(markdown)
  );
}
/**
 * A memory writer whose delivered output was NOT stored, as announced by the
 * `memory:discarded` event (lib/events/emit.ts → emitMemoryDiscarded).
 */
interface MemoryDiscard {
  source: "dreaming" | "distill";
  reason: MemoryDiscardReason;
  sessionId: string;
}

/**
 * Why a writer's output was dropped, one sentence per reason CODE. The server
 * sends the code, never a sentence: it does not know the viewer's locale.
 */
const DISCARD_REASON_KEYS: Record<MemoryDiscardReason, TranslationKey> = {
  no_output: "Spec.memory.discarded.reasons.noOutput",
  invalid_structure: "Spec.memory.discarded.reasons.invalidStructure",
  memory_changed: "Spec.memory.discarded.reasons.memoryChanged",
  save_failed: "Spec.memory.discarded.reasons.saveFailed",
};

/** The snapshot text behind the archive bar, fetched when a restore is armed. */
type ArchivePreview =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "error" };

interface MemoryPanelProps {
  projectId?: string;
  /** Edit or preview mode, shared with the spec editor or switched locally. */
  mode: "edit" | "preview";
  /** Applied to the band wrapper — the page uses it for the stacked layout. */
  className?: string;
}

/**
 * The provenance word per write source. A module-scope map of catalogue KEY
 * REFERENCES rather than a `t(\`sources.${source}\`)` — an id → key choice is
 * always an explicit map (`lib/i18n/catalogue.ts`, pattern 3).
 */
const SOURCE_COPY: Record<
  MemoryWriteSource | "unknown",
  { labelKey: TranslationKey }
> = {
  manual: { labelKey: "Spec.memory.sources.manual" },
  dreaming: { labelKey: "Spec.memory.sources.dreaming" },
  distill: { labelKey: "Spec.memory.sources.distill" },
  unknown: { labelKey: "Spec.memory.sources.unknown" },
};

function sourceLabelKey(
  source: MemoryWriteSource | null | undefined,
): TranslationKey {
  return SOURCE_COPY[source ?? "unknown"].labelKey;
}

/**
 * The learned-memory panel of the Spec & Memory section (the "gérer la
 * section mémoire" epic):
 *
 * - pairs as an equal peer next to the spec editor;
 * - edit/preview modes driven by the section's tab;
 * - token cap indicator and approaching warning;
 * - template skeleton for the 4 Dreaming sections when empty/non-conforming;
 * - last write provenance in header (manual / Dreaming / distillation) + timestamp;
 * - 1-click pre-dream snapshot restore with explicit confirmation, previewing
 *   the snapshot text (fetched on demand from GET /memory/restore);
 * - read-only mode and prominent banner while an agent rewrite is in flight;
 * - live sync via SSE on memory:changed events;
 * - saves carry the memory they were edited from (`expectedPrevious`); a
 *   background write locks Save until the draft is discarded, and a 409 from
 *   the server lands in the same state;
 * - a writer whose output was dropped (`memory:discarded`) is said in words,
 *   with the reason translated from its code and a link to the session;
 * - `id="memory-panel"`: notification deep links (/projects/[id]/spec#memory-panel)
 *   scroll straight to this panel.
 *
 * FRAME 8b, AND THE GAP IT DRAWS. The frame shows discrete white "entry" cards,
 * one learned fact each, with a per-entry mono provenance and inline
 * `garder` / `jeter` actions. THERE IS NO SUCH STORE: memory is a single
 * markdown document behind app/api/projects/[projectId]/memory/*, with ONE
 * document-level provenance record. Per-entry text, per-entry source session
 * and a kept/discarded flag would all be new columns on a new table.
 *
 * So this band renders the document as ONE editable white card and omits
 * `garder` / `jeter` entirely. Splitting the markdown into pseudo-entries by
 * parsing bullets was considered and rejected: `jeter` would then have to
 * rewrite the whole document by string surgery, and a wrong split silently
 * deletes learned conventions.
 */
export function MemoryPanel({
  projectId: propsProjectId,
  mode,
  className,
}: MemoryPanelProps) {
  const locale = useLocale();
  const t = useTranslations("Spec");
  // The provenance table holds full dotted paths, so it resolves through the
  // namespace-less translator.
  const tKey = useTranslations();
  const hookParams = useParams();
  const router = useRouter();
  const projectId = propsProjectId || (hookParams?.projectId as string) || "";
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<MemoryWriteProvenance | null>(null);
  const [archive, setArchive] = useState<MemoryEnvelope["archive"]>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(
    null
  );
  const [discard, setDiscard] = useState<MemoryDiscard | null>(null);
  const [pendingWriter, setPendingWriter] = useState<
    MemoryEnvelope["pendingWriter"]
  >(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [dreaming, setDreaming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backgroundUpdateConflict, setBackgroundUpdateConflict] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const safeContent = content;
  const estimatedTokens = estimateTokens(safeContent);
  const overCap = estimatedTokens > PROJECT_MEMORY_MAX_TOKENS;
  const approachingCap =
    !overCap && estimatedTokens >= Math.floor(PROJECT_MEMORY_MAX_TOKENS * 0.85);
  const dirty = safeContent !== savedContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savedContentRef = useRef(savedContent);
  savedContentRef.current = savedContent;
  const pendingWriterRef = useRef(pendingWriter);
  pendingWriterRef.current = pendingWriter;

  const missingSections = DREAMING_MEMORY_SECTIONS.filter((section) =>
    !new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(safeContent)
  );
  const hasMissingSections = missingSections.length > 0;

  const applyEnvelope = useCallback(
    (envelope: Partial<MemoryEnvelope>, keepLocalEdit: boolean) => {
      const incomingContent = envelope.content ?? "";
      const previousSaved = savedContentRef.current;
      setSavedContent(incomingContent);
      setUpdatedAt(envelope.updatedAt ?? null);
      setProvenance(envelope.provenance ?? null);
      setArchive(envelope.archive ?? null);
      setPendingWriter(envelope.pendingWriter ?? null);
      if (!keepLocalEdit) {
        setContent(incomingContent);
        setBackgroundUpdateConflict(false);
      } else {
        if (incomingContent !== previousSaved) {
          setBackgroundUpdateConflict(true);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    setError(null);
    fetch(`/api/projects/${projectId}/memory`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || t("memory.errors.load"));
        }
        return data as { data: Partial<MemoryEnvelope> };
      })
      .then((data) => {
        if (cancelled) return;
        applyEnvelope(data.data ?? {}, false);
        setLoaded(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err?.message || t("memory.errors.load"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, applyEnvelope, t]);

  const refetchMemory = useCallback(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/memory`)
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json().catch(() => null)) as {
          data: Partial<MemoryEnvelope>;
        } | null;
      })
      .then((data) => {
        if (data?.data) {
          applyEnvelope(data.data, dirtyRef.current);
        }
      })
      .catch(() => {});
  }, [projectId, applyEnvelope]);

  const { pollTick } = useProjectEvents(projectId, {
    "memory:changed": () => {
      // A write landed after the discard: the notice is about a past state.
      setDiscard(null);
      refetchMemory();
    },
    // A writer answered but its output was dropped. The session row carries
    // the failure durably; this is the word an open panel shows for it.
    "memory:discarded": (event) => {
      const source = event.data?.source;
      const reason = event.data?.reason;
      const sessionId = event.data?.sessionId;
      if (
        (source === "dreaming" || source === "distill") &&
        isMemoryDiscardReason(reason) &&
        typeof sessionId === "string"
      ) {
        setDiscard({ source, reason, sessionId });
      }
      refetchMemory();
    },
    "session:started": (event) => {
      const agentType = typeof event.data?.agentType === "string" ? event.data.agentType : "";
      if (MEMORY_WRITER_AGENT_TYPES.includes(agentType)) {
        refetchMemory();
      }
    },
    "session:completed": (event) => {
      const agentType = typeof event.data?.agentType === "string" ? event.data.agentType : "";
      const sessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : "";
      if (
        MEMORY_WRITER_AGENT_TYPES.includes(agentType) ||
        (pendingWriterRef.current && pendingWriterRef.current.sessionId === sessionId)
      ) {
        refetchMemory();
      }
    },
    "session:failed": (event) => {
      const agentType = typeof event.data?.agentType === "string" ? event.data.agentType : "";
      const sessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : "";
      if (
        MEMORY_WRITER_AGENT_TYPES.includes(agentType) ||
        (pendingWriterRef.current && pendingWriterRef.current.sessionId === sessionId)
      ) {
        refetchMemory();
      }
    },
  });
  useEffect(() => {
    if (pollTick > 0) {
      refetchMemory();
    }
  }, [pollTick, refetchMemory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const scroll = () => {
      if (window.location.hash === "#memory-panel") {
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    scroll();
    window.addEventListener("hashchange", scroll);
    return () => window.removeEventListener("hashchange", scroll);
  }, []);

  async function handleSave() {
    if (!projectId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    setDiscard(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memory`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // What this draft was edited FROM: the server refuses the save when
        // the stored memory has moved since (a dream landed, say), rather than
        // replacing text this editor never saw.
        body: JSON.stringify({
          content: safeContent,
          expectedPrevious: savedContent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === "MEMORY_CHANGED") {
        // The race the SSE event did not win. Same state as a background
        // update: the draft stays, Save locks, Discard loads the new text.
        setBackgroundUpdateConflict(true);
        refetchMemory();
        return;
      }
      if (!res.ok) {
        setError(data.error || t("memory.errors.save"));
        return;
      }
      applyEnvelope(data.data as Partial<MemoryEnvelope>, false);
      setMessage(t("memory.saved"));
    } catch {
      setError(t("memory.errors.save"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore() {
    if (!projectId) return;
    setRestoring(true);
    setMessage(null);
    setError(null);
    setConfirmingRestore(false);
    setArchivePreview(null);
    setDiscard(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memory/restore`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("memory.errors.restore"));
        return;
      }
      applyEnvelope(data.data as Partial<MemoryEnvelope>, false);
      setMessage(t("memory.restored"));
    } catch {
      setError(t("memory.errors.restore"));
    } finally {
      setRestoring(false);
    }
  }

  /**
   * Arms the restore AND fetches the snapshot it would put back. The text is
   * not in the envelope (it would ride every refetch); it is only worth
   * sending now, when the user is deciding whether to replace the memory.
   */
  function armRestore() {
    if (!projectId) return;
    setConfirmingRestore(true);
    setArchivePreview({ status: "loading" });
    fetch(`/api/projects/${projectId}/memory/restore`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || typeof data?.data?.content !== "string") {
          throw new Error("snapshot unavailable");
        }
        setArchivePreview({ status: "ready", content: data.data.content });
      })
      .catch(() => setArchivePreview({ status: "error" }));
  }

  function cancelRestore() {
    setConfirmingRestore(false);
    setArchivePreview(null);
  }

  async function handleDream() {
    if (!projectId) return;
    setDreaming(true);
    setMessage(null);
    setError(null);
    setDiscard(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memory/dream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("memory.errors.dream"));
        return;
      }
      const dreamSessionId = data.data?.sessionId;
      if (!dreamSessionId) {
        // Picked by the guard's CODE: the server's `reason` is an English
        // journal sentence, and splicing it into a translated one is exactly
        // how a French panel ends up speaking English.
        setMessage(
          data.data?.code === "no_new_sessions"
            ? t("memory.dreamSkipped.noNewSessions")
            : t("memory.nothingToDream")
        );
        return;
      }
      router.push(`/projects/${projectId}/sessions/${dreamSessionId}`);
    } catch {
      setError(t("memory.errors.dream"));
    } finally {
      setDreaming(false);
    }
  }

  function handleInsertSkeleton() {
    if (!safeContent.trim()) {
      setContent(DREAMING_MEMORY_TEMPLATE);
      setMessage(t("memory.skeletonInserted"));
      return;
    }
    const missing = DREAMING_MEMORY_SECTIONS.filter((section) =>
      !new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(safeContent)
    );
    if (missing.length > 0) {
      const toAppend = missing.map((title) => `## ${title}\n\n- `).join("\n\n");
      const separator = safeContent.endsWith("\n\n") ? "" : safeContent.endsWith("\n") ? "\n" : "\n\n";
      setContent(`${safeContent}${separator}${toAppend}`);
      setMessage(
        t("memory.sectionsAppended", { sections: missing.join(", ") })
      );
    } else {
      setMessage(t("memory.allSectionsPresent"));
    }
  }

  // The cap indicator is the one numeral on this band that changes tone, and
  // it changes it for a NUMBER crossing a threshold, not for a UI state.
  //
  // Amber is not a Piscine colour, so "approaching" borrows the SAND deep —
  // `land-deep` (#756008). It used to say `you-deep`, which the comment
  // already called the sand deep but which actually resolves to the coral
  // #a63a1a — the very same value as `danger`, in BOTH themes. The middle
  // step of a three-step ramp rendered identically to its last step, so
  // "approaching the cap" was invisible until the cap was already blown.
  const capTone: MonoTone = overCap
    ? "danger"
    : approachingCap
      ? "land-deep"
      : "live-mid";

  const provenanceStamp = provenance?.at ?? updatedAt;

  return (
    <div
      ref={panelRef}
      id="memory-panel"
      data-testid="memory-card"
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <StrataBand
        stratum="live"
        density="rail"
        gap={9}
        grow
        className="px-[16px] py-[14px]"
      >
        {/*
          The band label reads MEMORY; screen readers still get a real
          document heading, which is also what pins the accessible structure
          the existing suite asserts.
        */}
        <h3 className="sr-only">{t("memory.heading")}</h3>

        <BandHeader
          stratum="live"
          label={t("memory.label")}
          labelSize={12}
          meta={t("memory.helper")}
          right={
            <span data-testid="memory-cap-indicator">
              <Mono size={10.5} tone={capTone}>
                {t("memory.capIndicator", {
                  tokens: estimatedTokens,
                  max: PROJECT_MEMORY_MAX_TOKENS,
                })}
              </Mono>
            </span>
          }
        />

        {/* An agent is rewriting this document: the editor goes read-only. */}
        {pendingWriter && (
          <div data-testid="memory-pending-writer-banner" className="flex-none">
            <SurfaceCard
              radius={10}
              className="flex flex-wrap items-center gap-[8px] px-[11px] py-[9px]"
            >
              <Sparkles
                size={13}
                aria-hidden="true"
                className="shrink-0 text-strata-live-deep"
              />
              <span className="text-[12px] text-foreground">
                {pendingWriter.agentType === "memory_distill"
                  ? t("memory.pendingWriter.distill")
                  : t("memory.pendingWriter.dreaming")}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {t("memory.pendingWriter.readOnly")}
              </span>
              <QuietLink
                tone="live"
                size={11.5}
                className="ml-auto"
                href={`/projects/${projectId}/sessions/${pendingWriter.sessionId}`}
              >
                {t("memory.pendingWriter.viewSession")}
              </QuietLink>
            </SurfaceCard>
          </div>
        )}

        {/* The document moved under the user's feet while they were editing. */}
        {backgroundUpdateConflict && dirty && (
          <div data-testid="memory-conflict-notice" className="flex-none">
            <SurfaceCard
              radius={10}
              className="flex items-start gap-[8px] px-[11px] py-[9px]"
            >
              <AlertTriangle
                size={13}
                aria-hidden="true"
                className="mt-[2px] shrink-0 text-destructive"
              />
              <span className="text-[12px] text-foreground">
                {t("memory.conflictNotice")}
              </span>
            </SurfaceCard>
          </div>
        )}

        {/* A writer answered, but its output was dropped — said in words. */}
        {discard && (
          <div data-testid="memory-discard-notice" className="flex-none">
            <SurfaceCard
              radius={10}
              className="flex flex-wrap items-center gap-[8px] px-[11px] py-[9px]"
            >
              <CircleSlash
                size={13}
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 text-[12px] text-foreground">
                {discard.source === "distill"
                  ? t("memory.discarded.distill", {
                      reason: tKey(DISCARD_REASON_KEYS[discard.reason]),
                    })
                  : t("memory.discarded.dreaming", {
                      reason: tKey(DISCARD_REASON_KEYS[discard.reason]),
                    })}
              </span>
              <div className="ml-auto flex items-center gap-[8px]">
                <QuietLink
                  tone="live"
                  size={11.5}
                  href={`/projects/${projectId}/sessions/${discard.sessionId}`}
                >
                  {t("memory.viewSession")}
                </QuietLink>
                <PillButton
                  variant="outline"
                  outlineTone="neutral"
                  size="sm"
                  onClick={() => setDiscard(null)}
                >
                  {t("memory.discarded.dismiss")}
                </PillButton>
              </div>
            </SurfaceCard>
          </div>
        )}

        {loading ? (
          <p className="text-[12.5px] text-muted-foreground">
            {t("memory.loading")}
          </p>
        ) : !loaded ? (
          <p className="text-[12.5px] text-destructive">
            {error ?? t("memory.errors.load")} {t("memory.reloadHint")}
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-[9px]">
            {/* Empty or non-conforming memory: offer the 4 Dreaming sections. */}
            {mode === "edit" && hasMissingSections && !pendingWriter && (
              <div
                data-testid="memory-skeleton-suggestion"
                className="flex flex-none items-center gap-[8px] rounded-[10px] border-[1.5px] border-dashed border-border-strong px-[11px] py-[9px]"
              >
                <FileText
                  size={13}
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 text-[12px] text-muted-foreground">
                  {!safeContent.trim()
                    ? t("memory.skeleton.empty")
                    : t("memory.skeleton.missing", {
                        sections: missingSections.join(", "),
                      })}
                </span>
                <PillButton
                  variant="outline"
                  outlineTone="action"
                  size="sm"
                  className="ml-auto"
                  onClick={handleInsertSkeleton}
                >
                  {!safeContent.trim()
                    ? t("memory.skeleton.useTemplate")
                    : t("memory.skeleton.append")}
                </PillButton>
              </div>
            )}

            {mode === "edit" ? (
              <SurfaceCard
                radius={10}
                className="flex min-h-0 flex-1 flex-col overflow-hidden px-[12px] py-[10px]"
              >
                <Textarea
                  data-testid="memory-editor"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setMessage(null);
                  }}
                  disabled={!!pendingWriter || saving || restoring}
                  placeholder={t("memory.editorPlaceholder")}
                  className="h-full min-h-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 font-mono text-[12.5px] leading-[1.6] shadow-none focus-visible:border-0 focus-visible:ring-0"
                />
              </SurfaceCard>
            ) : (
              <div
                data-testid="memory-preview"
                className="flex min-h-0 flex-1 flex-col"
              >
                <SurfaceCard
                  radius={10}
                  className="min-h-0 flex-1 overflow-y-auto px-[12px] py-[10px]"
                >
                  {safeContent.trim() ? (
                    <SpecPreview markdown={safeContent} />
                  ) : (
                    <p className="text-[12.5px] text-muted-foreground">
                      {t("memory.emptyPreview")}
                    </p>
                  )}
                </SurfaceCard>
              </div>
            )}

            {/* Pre-dream snapshot restore, behind an explicit confirmation. */}
            {archive && (
              <div
                data-testid="memory-archive-bar"
                className="flex flex-none flex-wrap items-center gap-[8px] rounded-[10px] border-[1.5px] border-dashed border-border-strong px-[11px] py-[9px]"
              >
                <span className="text-[12px] text-muted-foreground">
                  {archive.updatedAt
                    ? t("memory.archive.existsAt", {
                        date: formatDateTime(archive.updatedAt, {
                          locale,
                          style: "dateTimeSeconds",
                        }),
                      })
                    : t("memory.archive.exists")}
                </span>
                {confirmingRestore ? (
                  <div className="ml-auto flex items-center gap-[6px]">
                    <span className="text-[11.5px] font-semibold text-foreground">
                      {t("memory.archive.confirmQuestion")}
                    </span>
                    <PillButton
                      variant="filled"
                      size="sm"
                      onClick={handleRestore}
                      disabled={restoring || saving || dirty}
                      pending={restoring}
                      pendingLabel={t("memory.archive.restorePending")}
                    >
                      {t("memory.archive.confirm")}
                    </PillButton>
                    <PillButton
                      variant="outline"
                      outlineTone="neutral"
                      size="sm"
                      onClick={cancelRestore}
                      disabled={restoring}
                    >
                      {t("memory.archive.cancel")}
                    </PillButton>
                  </div>
                ) : (
                  <PillButton
                    variant="outline"
                    outlineTone="action"
                    size="sm"
                    icon={RotateCcw}
                    className="ml-auto"
                    onClick={armRestore}
                    disabled={restoring || saving || dirty || !!pendingWriter}
                    title={
                      dirty
                        ? t("memory.archive.restoreBlockedTitle")
                        : t("memory.archive.restoreTitle")
                    }
                  >
                    {t("memory.archive.restore")}
                  </PillButton>
                )}
                {/* What the restore would put back, read before confirming. */}
                {confirmingRestore && archivePreview && (
                  <div
                    data-testid="memory-archive-preview"
                    className="max-h-[180px] w-full basis-full overflow-y-auto rounded-[8px] bg-background px-[10px] py-[8px]"
                  >
                    {archivePreview.status === "ready" ? (
                      archivePreview.content.trim() ? (
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-foreground">
                          {archivePreview.content}
                        </pre>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          {t("memory.archive.previewEmpty")}
                        </p>
                      )
                    ) : (
                      <p className="text-[12px] text-muted-foreground">
                        {archivePreview.status === "loading"
                          ? t("memory.archive.previewLoading")
                          : t("memory.archive.previewError")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-none items-center gap-[8px]">
              {/*
                One document-level provenance line replaces the frame's
                per-entry `session #b2 · 2d ago` stamps: memory is a single
                markdown document here, with one write provenance record.
              */}
              <div
                data-testid="memory-provenance-bar"
                className="flex min-w-0 items-center gap-[6px]"
              >
                {/*
                  11px, not 9.5: this is mixed-case prose ("Manual edit ·
                  18/08/2026 14:02"), and the 9.5px floor exemption covers
                  UPPERCASE TRACKED mono labels only.
                */}
                <Mono size={11} tone="live-mid" clamp={1}>
                  {provenanceStamp
                    ? t("memory.provenance", {
                        source: tKey(sourceLabelKey(provenance?.source)),
                        stamp: formatDateTime(provenanceStamp, {
                          locale,
                          style: "dateTimeSeconds",
                        }),
                      })
                    : tKey(sourceLabelKey(provenance?.source))}
                </Mono>
                {provenance?.sessionId && (
                  <QuietLink
                    tone="live"
                    size={11.5}
                    className="shrink-0"
                    href={`/projects/${projectId}/sessions/${provenance.sessionId}`}
                  >
                    {t("memory.viewSession")}
                  </QuietLink>
                )}
              </div>

              <div className="ml-auto flex flex-none items-center gap-[8px]">
                {dirty && (
                  <PillButton
                    variant="outline"
                    outlineTone="neutral"
                    size="sm"
                    onClick={() => {
                      setContent(savedContent);
                      setMessage(null);
                      setBackgroundUpdateConflict(false);
                    }}
                    disabled={saving}
                    title={t("memory.discardTitle")}
                  >
                    {t("memory.discard")}
                  </PillButton>
                )}
                <PillButton
                  variant="outline"
                  outlineTone="action"
                  size="sm"
                  icon={Moon}
                  onClick={handleDream}
                  disabled={dreaming || saving || dirty || !!pendingWriter}
                  pending={dreaming}
                  pendingLabel={t("memory.dreamPending")}
                  title={
                    dirty
                      ? t("memory.dreamBlockedTitle")
                      : t("memory.dreamTitle")
                  }
                >
                  {t("memory.dream")}
                </PillButton>
                {/* The one filled button in this row. */}
                <PillButton
                  variant="filled"
                  size="sm"
                  onClick={handleSave}
                  // Locked while a background write conflicts with the draft:
                  // saving would replace text this editor never saw.
                  disabled={
                    saving ||
                    overCap ||
                    !dirty ||
                    !!pendingWriter ||
                    backgroundUpdateConflict
                  }
                  pending={saving}
                  pendingLabel={t("memory.savePending")}
                >
                  {t("memory.save")}
                </PillButton>
              </div>
            </div>
          </div>
        )}

        {/* The sentence tracks the numeral's ramp: sand deep for approaching,
            coral for over. It said `text-strata-you-deep` here too, which is
            the same #a63a1a as `text-destructive` below it. */}
        {approachingCap && (
          <p className="flex-none text-[12px] text-strata-land-deep">
            {t("memory.approachingCap", {
              tokens: estimatedTokens,
              max: PROJECT_MEMORY_MAX_TOKENS,
            })}
          </p>
        )}
        {overCap && (
          <p className="flex-none text-[12px] text-destructive">
            {t("memory.overCap", {
              tokens: estimatedTokens,
              max: PROJECT_MEMORY_MAX_TOKENS,
            })}
          </p>
        )}
        {message && (
          <p className="flex-none text-[12px] text-strata-live-deep">{message}</p>
        )}
        {error && loaded && (
          <p className="flex-none text-[12px] text-destructive">{error}</p>
        )}
      </StrataBand>
    </div>
  );
}
