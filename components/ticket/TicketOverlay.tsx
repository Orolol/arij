"use client";

import { useTicketDerivedCopy } from "@/components/ticket/copy";
import { useLocale, useTranslations } from "next-intl";
/**
 * Frame 6a — the ticket, opened as a modal over a still-live desk.
 *
 * This replaces the old three-tab side panel (`components/kanban/EpicDetail`
 * and `components/kanban/epic-detail/**`). Details, Code Review and Activity
 * collapse into one 7/3 screen; nothing hides behind a tab except the full
 * diff, which swaps the body in place.
 *
 * The desk keeps living behind the scrim: closing the overlay must not
 * unmount or remount anything on it, so this component owns no board state
 * and nothing it renders reaches outside itself.
 *
 * TESTIDS. The scrim carries `ticket-overlay`; the modal carries
 * `epic-detail-panel`, the id three Playwright specs go through
 * (`e2e/fixtures/board.ts`). That fixture also asserts the panel contains no
 * text "Loading..." — so the literal string is never rendered anywhere in
 * this tree, in any state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2, Wrench } from "lucide-react";

import { AgentDispatchDialog } from "@/components/shared/AgentDispatchDialog";
import { SendToDevDialog } from "@/components/shared/SendToDevDialog";
import { PermanentDeleteDialog } from "@/components/shared/PermanentDeleteDialog";
import { DiffViewer } from "@/components/review/DiffViewer";
import { Mono, PillButton, QuietDangerAction } from "@/components/piscine";
import { isAgentAlreadyRunningError } from "@/lib/agents/client-error";
import { cn } from "@/lib/utils";
import { useTicketOverlayData } from "@/hooks/useTicketOverlayData";
import { pipelineRunLine, pipelineRunStage, pipelineSteps, ticketLabel } from "@/components/ticket/derive";
import { AgentActivityBand } from "@/components/ticket/AgentActivityBand";
import { AgentsBand } from "@/components/ticket/AgentsBand";
import { ConversationBand } from "@/components/ticket/ConversationBand";
import { DependenciesBand } from "@/components/ticket/DependenciesBand";
import { GitBand } from "@/components/ticket/GitBand";
import { PipelineCard } from "@/components/ticket/PipelineCard";
import { SessionArtifactsBand } from "@/components/ticket/SessionArtifactsBand";
import { TicketDescriptionCard } from "@/components/ticket/TicketDescriptionCard";
import { TicketOverlayHeader } from "@/components/ticket/TicketOverlayHeader";
import { UserStoriesBand } from "@/components/ticket/UserStoriesBand";
import { VerifyBand } from "@/components/ticket/VerifyBand";
import { descriptionMeta } from "@/components/ticket/derive";

export interface TicketOverlayProps {
  projectId: string;
  epicId: string | null;
  open: boolean;
  onClose: () => void;
  onMerged?: () => void;
  onDeleted?: () => void;
  /**
   * Where a 409 AGENT_ALREADY_RUNNING goes. Omit it and the refusal is shown
   * in the pipeline card like any other dispatch failure — never dropped.
   */
  onAgentConflict?: (args: { message: string; sessionUrl?: string }) => void;
  /**
   * Open another ticket of the same project in place of this one — what a
   * BLOCKS / WAITS ON chip does. The host owns which ticket is open, so the
   * overlay cannot swap itself.
   */
  onOpenTicket?: (epicId: string) => void;
  /** `"diff"` opens straight onto the full diff (a desk CONFLICT row's Diff). */
  initialView?: TicketOverlayView;
  /** Project SSE/fallback refresh counter from the host page. */
  refreshTrigger?: number;
}

export type TicketOverlayView = "ticket" | "diff";

export function TicketOverlay(props: TicketOverlayProps) {
  if (!props.open) return null;
  // A ticket owns all its drafts, dialogs, selections and asynchronous loaders.
  // Remount the complete tree when its identity changes, including its project.
  return <TicketOverlayContent key={`${props.projectId}:${props.epicId}`} {...props} />;
}

function TicketOverlayContent({
  projectId,
  epicId,
  open,
  onClose,
  onMerged,
  onDeleted,
  onAgentConflict,
  onOpenTicket,
  initialView = "ticket",
  refreshTrigger = 0,
}: TicketOverlayProps) {
  const derivedCopy = useTicketDerivedCopy();
  const locale = useLocale();
  const t = useTranslations("Ticket");
  const tErrors = useTranslations("ClientErrors");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [diffView, setDiffView] = useState(initialView === "diff");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resolveMergeOpen, setResolveMergeOpen] = useState(false);
  const [resolvingMerge, setResolvingMerge] = useState(false);
  const [resolveMergeAgentId, setResolveMergeAgentId] = useState<
    string | null
  >(null);
  const [resolveMergeResumeSessionId, setResolveMergeResumeSessionId] =
    useState<string | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    null,
  );
  const [stopping, setStopping] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [backToDevOpen, setBackToDevOpen] = useState(false);
  const [backToDevSeed, setBackToDevSeed] = useState("");

  const data = useTicketOverlayData(projectId, epicId, open, {
    refreshTrigger,
    onMergeSuccess: () => {
      onMerged?.();
      onClose();
    },
    onDeleteSuccess: () => {
      setDeleteDialogOpen(false);
      onClose();
      onDeleted?.();
    },
  });

  const {
    epic,
    userStories,
    loading,
    loadError,
    updateEpic,
    refresh,
    comments,
    addComment,
    activeSession,
    agentType,
    isRunning,
    dispatching,
    sendToDev,
    sendToReview,
    sendToGrading,
    resolveMerge,
    stopSession,
    merge,
    merging,
    mergeError,
    mergeConflict,
    conflictFiles,
    setMergeError,
    deleteEpic,
    deletingEpic,
    deleteEpicError,
    pr,
    prLoading,
    prReady,
    refreshPr,
    prError,
    createPr,
    syncPr,
    githubConfigured,
    blocks,
    waitsOn,
    waitsOnOptions,
    toggleWaitsOn,
    dependencySaving,
    dependencyLoading,
    dependencyReady,
    refreshDependencies,
    dependencyError,
    namedAgents,
    gradingStatus,
    gradingSummary,
    verificationReport,
    runVerification,
    verifyRunning,
    verifyError,
    artifacts,
    artifactsError,
    refreshArtifacts,
    diffstat,
    timeline,
    sessionMeta,
    sessionHref,
    pipelineRun,
    queuePlacement,
    queueMoving,
    queueError,
    moveInQueue,
    projectName,
    tone,
  } = data;

  /* ---------------- close semantics --------------------------------- */

  const escapeBlocked =
    deleteDialogOpen || resolveMergeOpen || rebuildOpen || backToDevOpen;

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!open) return;
      // The delete and dispatch dialogs own Escape while they are up: it must
      // close only the dialog, never the ticket behind it.
      if (escapeBlocked) return;
      if (event.defaultPrevented) return;
      onClose();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, onClose, escapeBlocked]);

  // The desk behind must not scroll under the scrim.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Focus moves into the modal on open and returns to the opener on close.
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => {
      opener?.focus?.();
    };
  }, [open]);

  /* ---------------- handlers ---------------------------------------- */

  const handleStatusChange = useCallback(
    async (next: string) => {
      setStatusError(null);
      const result = await updateEpic({ status: next });
      if (!result.ok) setStatusError(result.error ?? null);
    },
    [updateEpic],
  );

  const handlePriorityChange = useCallback(
    async (next: number) => {
      setStatusError(null);
      const result = await updateEpic({ priority: next });
      if (!result.ok) setStatusError(result.error ?? null);
    },
    [updateEpic],
  );

  const reportConflict = useCallback(
    (error: unknown) => {
      if (!mounted.current) return false;
      // Only "handled" when someone took it: without a sink the caller falls
      // through to its own error line, or the refusal would vanish.
      if (isAgentAlreadyRunningError(error) && onAgentConflict) {
        onAgentConflict({
          message: error.message,
          // The server does not always send sessionUrl; the fallback is
          // load-bearing, not belt-and-braces.
          sessionUrl:
            error.sessionUrl ||
            `/projects/${projectId}/sessions/${error.activeSessionId}`,
        });
        return true;
      }
      return false;
    },
    [onAgentConflict, projectId],
  );

  async function handleMerge() {
    // The merge IS the approval. useEpicMutations owns the request and its
    // error surface (mergeError / mergeConflict in the GIT band, next to the
    // Resolve action the message points at).
    await merge();
    // Refresh either way — on a merge failure the epic keeps its status, and
    // the overlay must re-read it rather than show a state the server refused.
    refresh();
  }

  async function handleResolveMerge(
    namedAgentId?: string | null,
    resumeSessionId?: string,
  ) {
    if (!epicId) return;
    setResolvingMerge(true);
    const outcome = await resolveMerge(namedAgentId, resumeSessionId).then(
      (result) => ({ result }),
      (error: unknown) => {
        reportConflict(error);
        setMergeError(error instanceof Error ? error.message : t("overlay.resolveMergeError"));
        return null;
      },
    );
    if (!mounted.current) return;
    if (outcome) {
      setMergeError(null);
      if (outcome.result?.clean) {
        onMerged?.();
        onClose();
      }
      setResolveMergeOpen(false);
      setResolveMergeResumeSessionId(undefined);
    }
    setResolvingMerge(false);
  }

  async function handleReview() {
    try {
      // "feature_review" is the shared default review type; do not invent one.
      await sendToReview(["feature_review"], selectedAgentId);
      refresh();
    } catch (error) {
      if (!reportConflict(error)) {
        setStatusError(error instanceof Error ? error.message : tErrors("agentRequestFailed"));
      }
    }
  }

  function handleRebuild() {
    // The dispatch contract (comment, agent, resumable session, pipeline
    // mode) lives in the shared dialog; the band's agent seeds its picker.
    setRebuildOpen(true);
  }

  async function handleGrade() {
    try {
      // Grading is observational: it writes a report and never moves the
      // ticket, so there is nothing to reconcile beyond the refresh.
      await sendToGrading(selectedAgentId);
      refresh();
    } catch (error) {
      if (!reportConflict(error)) {
        setStatusError(error instanceof Error ? error.message : tErrors("agentRequestFailed"));
      }
    }
  }

  async function handleBackToDev(reviewComment: string) {
    // The review comment seeds the shared dispatch dialog, where the user
    // confirms it (it stays editable) and the pipeline mode.
    setBackToDevSeed(reviewComment);
    setBackToDevOpen(true);
  }

  /** Shared confirm for both dev dispatch dialogs (rebuild, back-to-dev). */
  async function handleDispatchDev(
    comment: string | undefined,
    namedAgentId: string | null,
    sessionId: string | undefined,
    // undefined = no readable default and no user choice: omit the flag and
    // let the build route resolve `pipeline_enabled` itself.
    pipeline: boolean | undefined,
  ) {
    setSelectedAgentId(namedAgentId);
    try {
      await sendToDev(comment, namedAgentId, sessionId, pipeline);
      refresh();
      setRebuildOpen(false);
      setBackToDevOpen(false);
    } catch (error) {
      if (!reportConflict(error)) {
        setStatusError(error instanceof Error ? error.message : tErrors("agentRequestFailed"));
      }
    }
  }

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setCommentError(null);
    try {
      await addComment(content);
      setDraft("");
    } catch (error) {
      // The typed text stays in the field: losing a written reply to a
      // transient failure is worse than the failure.
      setCommentError(
        error instanceof Error ? error.message : t("overlay.commentError"),
      );
    }
    setSending(false);
  }

  async function handleStop() {
    setStopping(true);
    await stopSession();
    setStopping(false);
  }

  /* ---------------- render ------------------------------------------ */

  if (!open) return null;

  const titleId = "ticket-overlay-title";
  const label = ticketLabel(epic?.readableId, epicId);
  const projectLabel = (projectName ?? projectId ?? "").slice(0, 12).toUpperCase() || "—";
  // Only the ticket's OWN active run places the chain's live marker. A
  // finished run adds its outcome line, and a story run adds a line naming
  // its story: in both cases the column still drives the chain.
  const runLine = pipelineRun ? pipelineRunLine(pipelineRun, userStories) : null;
  const steps = pipelineSteps(
    epic?.status ?? "backlog",
    isRunning,
    pipelineRunStage(pipelineRun),
  );
  const cancellable =
    (activeSession as { cancellable?: boolean } | null)?.cancellable === true;
  // No ticket yet: every band below would otherwise paint its fallback
  // (status "backlog", priority 1, no stories) as if it were the ticket.
  const pending = !epic;

  return (
    <div
      data-testid="ticket-overlay"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center",
        "bg-scrim backdrop-blur-[3px]",
        "p-9 max-[1272px]:p-4",
      )}
      onClick={(event) => {
        // Only a click that started and ended on the scrim itself closes:
        // a click bubbling out of the modal must not.
        if (event.target !== event.currentTarget) return;
        onClose();
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="epic-detail-panel"
        className={cn(
          "flex max-h-full w-[min(1200px,100%)] flex-col overflow-hidden",
          "rounded-[20px] bg-background outline-none",
          // The ONE shadow in the entire Piscine system.
          "shadow-[var(--shadow-overlay)]",
        )}
      >
        <TicketOverlayHeader
          projectLabel={projectLabel}
          ticketLabel={label}
          tone={tone}
          title={epic?.title ?? "…"}
          titleId={titleId}
          agentType={agentType}
          isRunning={isRunning}
          startedAt={activeSession?.startedAt ?? null}
          cancellable={cancellable}
          stopping={stopping}
          onStop={handleStop}
          onClose={onClose}
        />

        {pending ? (
          <div
            data-testid="ticket-overlay-pending"
            aria-busy={loading}
            className="flex min-h-[160px] flex-1 items-center justify-center px-[14px] pb-[14px]"
          >
            {/* The literal "Loading..." is banned in this tree (see the file
                header). "…" only while a read is actually in flight: without
                a project there is no URL, so nothing loads and nothing fails,
                and the ellipsis would promise a ticket that never comes. */}
            {loading ? (
              <>
                <Mono size={13} tone="muted">
                  …
                </Mono>
                <span className="sr-only">{t("overlay.pending")}</span>
              </>
            ) : (
              <p role="alert" className="m-0 text-[13px] leading-[1.5] text-destructive">
                {!projectId || !epicId
                  ? t("overlay.noProject")
                  : (loadError ?? tErrors("failedToLoadTicket"))}
              </p>
            )}
          </div>
        ) : diffView && epicId && epic ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-[14px] pb-[14px]">
            <div className="flex shrink-0">
              <PillButton
                variant="outline"
                outlineTone="action"
                size="sm"
                icon={ArrowLeft}
                onClick={() => setDiffView(false)}
                data-testid="ticket-diff-back"
              >
                {t("overlay.backToTicket")}
              </PillButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DiffViewer
                projectId={projectId}
                epicId={epicId}
                epicStatus={epic.status}
                onBackToDev={handleBackToDev}
                onMerge={handleMerge}
                dispatching={dispatching}
                isRunning={isRunning}
              />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex min-h-0 flex-1 gap-3 px-[14px] pb-[14px]",
              "max-[1272px]:flex-col max-[1272px]:overflow-y-auto",
            )}
          >
            {/* Left column — 7 of 10. Scrolls as a whole so a long story list
                cannot eat the right rail. */}
            <div className="flex min-h-0 min-w-0 flex-[7] flex-col gap-3 overflow-y-auto max-[1272px]:flex-none max-[1272px]:overflow-visible">
              <TicketDescriptionCard
                description={epic?.description ?? null}
                meta={epic ? descriptionMeta(epic, locale, derivedCopy) : ""}
                projectId={projectId}
                images={epic?.images ?? null}
              />
              <UserStoriesBand
                stories={userStories}
                projectId={projectId}
                gradingStatus={gradingStatus}
                gradingSummary={gradingSummary}
                onStoryUpdated={refresh}
              />
              {/* The mechanical evidence, under the criteria it was run
                  against and above the prose the agent wrote about them. */}
              <VerifyBand
                report={verificationReport}
                onRun={() => void runVerification()}
                running={verifyRunning}
                error={verifyError}
                locked={isRunning || dispatching}
              />
              {/* What the change looks like, beside what the commands said
                  about it. Renders nothing on a ticket with no proof. */}
              <SessionArtifactsBand
                projectId={projectId}
                artifacts={artifacts}
                error={artifactsError}
                onRetry={() => void refreshArtifacts()}
              />
              <AgentActivityBand
                lines={timeline}
                isRunning={isRunning}
                meta={sessionMeta}
                sessionHref={sessionHref}
              />
              <ConversationBand
                comments={comments}
                draft={draft}
                onDraftChange={setDraft}
                onSend={handleSend}
                sending={sending}
                error={commentError}
              />
            </div>

            {/* Right column — 3 of 10. Bounded; the delete link is pinned to
                its bottom by margin-top:auto. */}
            <div className="flex min-h-0 min-w-0 flex-[3] flex-col gap-3 max-[1272px]:flex-none">
              <PipelineCard
                steps={steps}
                status={epic?.status ?? "backlog"}
                priority={epic?.priority ?? 1}
                hasRunningSession={isRunning}
                statusError={statusError}
                onStatusChange={handleStatusChange}
                onPriorityChange={handlePriorityChange}
                run={runLine}
                queue={queuePlacement}
                queueMoving={queueMoving}
                queueError={queueError}
                onQueueMove={(move) => void moveInQueue(move)}
              />
              <GitBand
                branchName={epic?.branchName ?? null}
                diffstat={diffstat}
                status={epic?.status ?? "backlog"}
                githubConfigured={githubConfigured}
                pr={pr}
                prLoading={prLoading}
                prReady={prReady}
                onRetryPr={() => void refreshPr()}
                prError={prError}
                onCreatePr={() => void createPr()}
                onSyncPr={() => void syncPr()}
                onOpenDiff={() => setDiffView(true)}
                onMerge={handleMerge}
                merging={merging}
                mergeError={mergeError}
                mergeConflict={mergeConflict}
                conflictFiles={conflictFiles}
                onResolveMerge={() => setResolveMergeOpen(true)}
                resolvingMerge={resolvingMerge}
                isRunning={isRunning}
              />
              <DependenciesBand
                blocks={blocks}
                waitsOn={waitsOn}
                tone={tone}
                onOpenTicket={onOpenTicket}
                options={waitsOnOptions}
                onToggleWaitsOn={toggleWaitsOn}
                saving={dependencySaving}
                loading={dependencyLoading}
                ready={dependencyReady}
                onRetry={() => void refreshDependencies()}
                error={dependencyError}
              />
              <AgentsBand
                agents={namedAgents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                onReview={handleReview}
                onRebuild={handleRebuild}
                onGrade={handleGrade}
                locked={dispatching || isRunning}
              />

              {deleteEpicError ? (
                <p className="m-0 text-[12px] leading-[1.5] text-destructive">
                  {deleteEpicError}
                </p>
              ) : null}

              <QuietDangerAction
                icon={Trash2}
                size={11.5}
                disabled={isRunning || dispatching}
                onClick={() => setDeleteDialogOpen(true)}
                className="mt-auto self-end"
              >
                {t("overlay.delete")}
              </QuietDangerAction>
            </div>
          </div>
        )}
      </div>

      <AgentDispatchDialog
        open={resolveMergeOpen}
        onOpenChange={(next) => {
          setResolveMergeOpen(next);
          if (!next) setResolveMergeResumeSessionId(undefined);
        }}
        title={t("overlay.resolveMergeTitle")}
        description={t("overlay.resolveMergeDescription")}
        projectId={projectId}
        agentProps={{
          value: resolveMergeAgentId,
          onChange: setResolveMergeAgentId,
          className: "w-44 h-8 text-xs",
          dispatchRole: "merge",
        }}
        sessionPicker={
          epicId
            ? {
                epicId,
                agentType: "merge",
                namedAgentId: resolveMergeAgentId,
                provider: "claude-code",
                selectedSessionId: resolveMergeResumeSessionId,
                onSelect: setResolveMergeResumeSessionId,
              }
            : undefined
        }
        confirmLabel={t("overlay.resolveMergeConfirm")}
        confirmIcon={<Wrench className="mr-1 h-4 w-4" />}
        busy={resolvingMerge}
        confirmDisabled={resolvingMerge || isRunning}
        onConfirm={() =>
          handleResolveMerge(resolveMergeAgentId, resolveMergeResumeSessionId)
        }
        onCancel={() => setResolveMergeOpen(false)}
      />

      <SendToDevDialog
        open={rebuildOpen}
        onOpenChange={setRebuildOpen}
        projectId={projectId}
        title={t("overlay.rebuildTitle")}
        description={t("overlay.rebuildDescription")}
        epicId={epicId ?? undefined}
        initialAgentId={selectedAgentId}
        busy={dispatching}
        locked={dispatching || isRunning}
        onConfirm={handleDispatchDev}
      />

      <SendToDevDialog
        open={backToDevOpen}
        onOpenChange={setBackToDevOpen}
        projectId={projectId}
        title={t("overlay.backToDevTitle")}
        description={t("overlay.backToDevDescription")}
        epicId={epicId ?? undefined}
        initialAgentId={selectedAgentId}
        defaultComment={backToDevSeed}
        commentRequired
        commentPlaceholder={t("overlay.backToDevPlaceholder")}
        busy={dispatching}
        locked={dispatching || isRunning}
        onConfirm={handleDispatchDev}
      />
      <PermanentDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("overlay.deleteTitle")}
        description={t("overlay.deleteDescription")}
        confirmLabel={t("overlay.deleteConfirm")}
        deleting={deletingEpic}
        locked={isRunning || dispatching}
        onConfirm={deleteEpic}
      />
    </div>
  );
}

export default TicketOverlay;
