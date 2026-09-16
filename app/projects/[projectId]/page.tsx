"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { ToastStack, type ToastItem } from "@/components/toast/ToastStack";
import { useToastStack } from "@/components/toast/useToastStack";
import { ProjectDeskDialogs } from "@/components/desk/ProjectDeskDialogs";
import { NowDesk } from "@/components/desk/NowDesk";
import { TicketOverlay } from "@/components/ticket/TicketOverlay";
import { UnifiedChatPanel, type UnifiedChatPanelHandle } from "@/components/chat/UnifiedChatPanel";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import { ProjectBatchToolbar } from "@/components/desk/ProjectBatchToolbar";
import { AutoModeToggle } from "@/components/auto-mode/AutoModeToggle";
import { RefinementButton } from "@/components/kanban/RefinementButton";
import { useConsumedQueryParam } from "@/hooks/useConsumedQueryParam";
import { useProjectEvents } from "@/hooks/useProjectEvents";

/**
 * `/projects/:id` — the SAME control desk as "/", pre-filtered to one project.
 *
 * The route stays alive because every deep link the project chrome produces
 * lands here (`?ticket=`, `?panel=`, `?night=`, `?nightRun=`, `?deleted=` —
 * see app/projects/[projectId]/layout.tsx), and because the ticket panel, the
 * night dialogs and the batch dispatch toolbar are project-scoped by nature.
 *
 * What this page owns, and the desk does not:
 * - the toast stack (the desk forwards into it through `onToast`);
 * - the URL deep links, each consumed once per value so a re-render cannot
 *   re-fire an imperative open;
 * - batch dispatch — build / review / merge over a multi-selection, reachable
 *   from the desk by ⌘/Ctrl-clicking tickets. The toolbar only exists while
 *   something is selected, so at rest the route is the desk and nothing else.
 */

export default function ProjectDeskPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  return <ProjectDesk key={projectId} projectId={projectId} />;
}

function ProjectDesk({ projectId }: { projectId: string }) {
  const t = useTranslations("Desk");
  const batch = useBatchSelection(projectId);
  const [namedAgentId, setNamedAgentId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [bugDialogOpen, setBugDialogOpen] = useState(false);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [nightDialogOpen, setNightDialogOpen] = useState(false);
  const [autoModeDialogOpen, setAutoModeDialogOpen] = useState(false);
  const [nightSummaryRunId, setNightSummaryRunId] = useState<string | null>(null);
  const { toasts, raise: addToast, dismiss: dismissRaised } = useToastStack();
  const [activeDetailTicketId, setActiveDetailTicketId] = useState<string | null>(null);
  const panelRef = useRef<UnifiedChatPanelHandle>(null);

  // Real-time events via SSE — the desk polls /api/control-desk on its own, but
  // the surfaces this page still owns (agent monitor, ticket panel) refresh on
  // the project's own event stream. pollTick increments when SSE is down.
  const refreshTicket = (event: { epicId?: string | null }) => {
    if (event.epicId === activeDetailTicketId) setRefreshTrigger((tick) => tick + 1);
  };
  const { pollTick } = useProjectEvents(projectId, {
    "ticket:moved": refreshTicket,
    "ticket:updated": refreshTicket,
    "ticket:deleted": refreshTicket,
    "session:started": refreshTicket,
    "session:completed": (event) => {
      refreshTicket(event);
      addToast("success", t("projectDesk.sessionCompleted", { id: String(event.data.sessionId ?? "").slice(0, 6) }));
    },
    "session:failed": (event) => {
      refreshTicket(event);
      addToast("error", t("projectDesk.sessionFailed", { id: String(event.data.sessionId ?? "").slice(0, 6), error: String(event.data.error ?? "") || t("projectDesk.unknownError") }));
    },
    "artifact:created": refreshTicket,
  });
  const refreshKey = refreshTrigger + pollTick;

  function handlePrimaryTicketClick(epicId: string) {
    setActiveDetailTicketId(epicId);
  }

  function handleCloseDetailPanel() {
    setActiveDetailTicketId(null);
  }

  // Refresh when the project layout imports arji.json.
  useEffect(() => {
    const onSynced = () => setRefreshTrigger((t) => t + 1);
    window.addEventListener("arji:synced", onSynced);
    return () => window.removeEventListener("arji:synced", onSynced);
  }, []);

  /**
   * A refinement pass reshapes columns, priorities and dependency edges
   * without emitting one event per write, so everything is reloaded once when
   * the pass ends rather than trusting the incremental SSE stream.
   */
  const handleRefinementFinished = useCallback(() => {
    setRefreshTrigger((t) => t + 1);
    addToast("success", t("projectDesk.refinementFinished"));
  }, [addToast, t]);

  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const dismissToast = useCallback((id: string) => {
    if (id === "deleted-notice") setDeletedNotice(null); else dismissRaised(id);
  }, [dismissRaised]);
  const visibleToasts: readonly ToastItem[] = deletedNotice
    ? [...toasts, { id: "deleted-notice", type: "success", message: deletedNotice }] : toasts;
  const href = `/projects/${projectId}`;
  useConsumedQueryParam("deleted", href, (value) => {
    if (value === "story") setDeletedNotice(t("projectDesk.storyDeleted"));
    if (value === "epic") setDeletedNotice(t("projectDesk.epicDeleted"));
  });
  useConsumedQueryParam("ticket", href, setActiveDetailTicketId);
  useConsumedQueryParam("panel", href, (value) => {
    if (value === "new-epic") panelRef.current?.openNewEpic();
    if (value === "new-epic-manual") setEpicDialogOpen(true);
    if (value === "new-bug") setBugDialogOpen(true);
  });
  useConsumedQueryParam("night", href, (value) => { if (value === "start") setNightDialogOpen(true); });
  useConsumedQueryParam("nightRun", href, setNightSummaryRunId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        {/* The ticket is a modal over a still-live desk now (frame 6a), not a
            column beside the chat: it is rendered below, outside the chat
            panel, so the desk keeps receiving SSE and keeps ticking behind
            the scrim. The chat panel keeps its own view to itself. */}
        <UnifiedChatPanel
          projectId={projectId}
          ref={panelRef}
          onEpicCreated={() => setRefreshTrigger((t) => t + 1)}
          onOpenTicket={handlePrimaryTicketClick}
          onToast={addToast}
        >
          <div className="flex h-full flex-col">
            {/* Project-scoped controls the desk's own chrome does not carry:
                the Full Auto CONFIGURATION dialog (the header pill is an on/off
                switch) and the Refinement pass.

                A row that FOLDS, not a fixed line — B-arij-jcJeNQZnT1X9. This
                bar lives inside the chat panel's slot, so beside the collapsed
                chat strip it has ~301px of content at 390px and ~231px at
                320px; the two buttons are `shrink-0` (a crushed label is no
                better than a clipped one) and Full Auto's live badge alone is
                ~240px when armed. On one fixed 46px line the hint was the only
                thing left to squeeze ("⌘-…", 31px of 231 at 390) and Agent
                Refinement was painted past the bar — 477px into a 390px screen
                with Full Auto armed — where the `overflow-hidden` hosts cut it
                off. Wrapping is width-driven rather than breakpoint-driven on
                purpose: the expanded chat panel narrows this slot on a desktop
                too. 46px stays as the FLOOR, so the one-line desktop bar keeps
                exactly its height. */}
            <div
              className="flex min-h-[46px] shrink-0 flex-wrap items-center gap-x-[12px] gap-y-[6px] border-b border-border bg-card px-[22px] py-[8px]"
              data-testid="board-capture-bar"
            >
              <AutoModeToggle
                projectId={projectId}
                onOpen={() => setAutoModeDialogOpen(true)}
                refreshTrigger={refreshKey}
              />
              <RefinementButton
                projectId={projectId}
                refreshTrigger={refreshKey}
                onError={(message) => addToast("error", message)}
                onNotice={(message) => addToast("success", message)}
                onStarted={() =>
                  addToast("success", t("projectDesk.refinementStarted"))
                }
                onFinished={handleRefinementFinished}
              />
              {/* `ml-auto` still hugs the right edge once the hint has wrapped
                  onto its own line; `truncate` is the last resort for a slot
                  narrower than the hint itself, not the rendering at 390px. */}
              <span
                className="ml-auto truncate text-[12.5px] text-muted-foreground"
                data-testid="board-capture-hint"
              >
                {t("projectDesk.selectHint")}
              </span>
            </div>

            <ProjectBatchToolbar
              projectId={projectId}
              batch={batch}
              namedAgentId={namedAgentId}
              onAgentChange={setNamedAgentId}
              onToast={addToast}
              onChanged={() => setRefreshTrigger((current) => current + 1)}
            />

            <div className="relative min-h-0 flex-1 overflow-hidden">
              <NowDesk
                projectId={projectId}
                onToast={addToast}
                onChanged={() => setRefreshTrigger((t) => t + 1)}
                selectedEpicIds={batch.allSelected}
                onToggleSelect={batch.toggle}
                onOpenTicket={handlePrimaryTicketClick}
              />
            </div>
          </div>
        </UnifiedChatPanel>
      </div>

      {/* Detail navigation and batch selection have separate lifetimes:
          Ctrl/⌘-click must leave the desk available for further selection. */}
      {activeDetailTicketId && (
        <TicketOverlay
          projectId={projectId}
          epicId={activeDetailTicketId}
          open
          refreshTrigger={refreshKey}
          onClose={handleCloseDetailPanel}
          onAgentConflict={({ message, sessionUrl }) =>
            addToast(
              "error",
              message,
              sessionUrl
                ? { href: sessionUrl, label: t("projectDesk.openActiveSession") }
                : undefined
            )
          }
          onMerged={() => {
            setRefreshTrigger((t) => t + 1);
            addToast("success", t("projectDesk.branchMerged"));
          }}
          onDeleted={() => {
            setRefreshTrigger((t) => t + 1);
            addToast("success", t("projectDesk.epicDeleted"));
          }}
        />
      )}

      <ToastStack items={visibleToasts} onDismiss={dismissToast} testId="board-toast" />

      <ProjectDeskDialogs
        projectId={projectId} namedAgentId={namedAgentId}
        epicDialogOpen={epicDialogOpen} setEpicDialogOpen={setEpicDialogOpen}
        bugDialogOpen={bugDialogOpen} setBugDialogOpen={setBugDialogOpen}
        nightDialogOpen={nightDialogOpen} setNightDialogOpen={setNightDialogOpen}
        autoModeDialogOpen={autoModeDialogOpen} setAutoModeDialogOpen={setAutoModeDialogOpen}
        nightSummaryRunId={nightSummaryRunId} setNightSummaryRunId={setNightSummaryRunId}
        onChanged={() => setRefreshTrigger((tick) => tick + 1)}
        onOpenTicket={handlePrimaryTicketClick} addToast={addToast}
      />

    </div>
  );
}
