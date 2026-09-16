"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import {
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuietLink } from "@/components/piscine";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { projectTone } from "@/components/piscine";
import { ChatComposer } from "@/components/chat-page/ChatComposer";
import { ChatNextSteps } from "@/components/chat-page/ChatNextSteps";
import { ChatThread } from "@/components/chat-page/ChatThread";
import { ConversationRoster } from "@/components/chat-page/ConversationRoster";
import { useConversationAgentLabels } from "@/components/chat-page/useConversationAgentLabels";
import { useThreadEpics } from "@/components/chat-page/useThreadEpics";
import { useControlDesk } from "@/hooks/useControlDesk";
import { usePanelLayout, DIVIDER_WIDTH, type UnifiedPanelState } from "@/hooks/usePanelLayout";
import { usePolling } from "@/hooks/usePolling";
import { BRAINSTORM_AGENT_TYPE, EPIC_CREATION_AGENT_TYPE } from "@/lib/chat/conversation-agent";
import {
  BRAINSTORM_CONVERSATION_LABEL,
  EPIC_CREATION_CONVERSATION_LABEL,
} from "@/lib/chat/conversation-labels";
import { isLegacyConversationGenerating } from "@/lib/chat/parity-contract";
import { cn } from "@/lib/utils";
import { useChatWorkspace } from "@/hooks/useChatWorkspace";

export type { UnifiedPanelState };

/**
 * The page's only way in from outside: `?panel=new-epic` (pushed by the
 * project layout's New menu) opens the panel on a fresh epic conversation.
 * The strip is the other entry and is internal. `openChat` / `collapse` /
 * `hide` had no producer and were removed (lot 10, #48).
 */
export interface UnifiedChatPanelHandle {
  openNewEpic: () => void;
}

interface UnifiedChatPanelProps {
  projectId: string;
  children: ReactNode;
  /** An epic was created from the thread; the board should reload. */
  onEpicCreated?: () => void;
  /** The in-thread epic cards open the ticket the page already overlays. */
  onOpenTicket: (epicId: string) => void;
  /** The in-thread epic cards report success and failure as toasts. */
  onToast: (tone: "success" | "error", message: string) => void;
  /**
   * Fires whenever the panel occupies board width (expanded on desktop).
   * The board uses it to hide the Released digest and reclaim the space.
   */
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * The chat beside the project desk.
 *
 * ONE RENDERING GRAMMAR (lot 10, #40). The panel keeps what only a side panel
 * has — collapse strip, resize divider, hide, Escape, the mobile Sheet,
 * polling only while visible — and renders the conversation with the chat
 * page's own components: `ConversationRoster` (compact), `ChatThread` (with
 * its in-thread epic cards and reader-respecting auto-scroll) and
 * `ChatComposer` (without the project pill: the scope is this page). The tab
 * bar, message list, input and proposal card it used to draw are gone.
 */
export const UnifiedChatPanel = forwardRef<UnifiedChatPanelHandle, UnifiedChatPanelProps>(
  function UnifiedChatPanel(
    { projectId, children, onEpicCreated, onOpenTicket, onToast, onExpandedChange },
    ref,
  ) {
    const t = useTranslations("Chat");
    const {
      conversations, activeId, setActiveId, conversationsLoading, mutating,
      createConversation, deleteConversation, restartPersistentSession, refreshConversations,
      renameConversation, renameDisabled,
      messages, loading, sending, error, pendingQuestions, streamStatus,
      sendMessage, answerQuestions, activeConversation,
      activeAgentSelection, agentLocked, attachmentsDisabled,
      hasUserMessage, isBrainstorm, isEpicCreation, busy, sendStartedAt,
      selectAgent, draftEpic, epicDrafting, generateSpec, generatingSpec, specResult,
      actionsDisabled,
    } = useChatWorkspace(projectId);

    // On /projects/:id the desk aggregate is already polled by the app-level
    // provider; this reads that shared copy for the epic cards' placement.
    const { data: desk, refresh: refreshDesk } = useControlDesk(projectId, 8000);
    const project = useMemo(
      () => desk?.projects.find((row) => row.id === projectId) ?? null,
      [desk, projectId],
    );

    const handleDeskChanged = useCallback(() => {
      void refreshDesk();
      onEpicCreated?.();
    }, [refreshDesk, onEpicCreated]);

    const { agentLabels, activeAgentLabel } = useConversationAgentLabels(
      conversations,
      activeConversation,
    );
    const {
      epicsByMessage,
      resolvedEpicByMessage,
      resolveTicket,
      recordEpicBinding,
      createdHere,
    } = useThreadEpics({
      projectId,
      activeId,
      activeConversation,
      messages,
      desk,
      onDeskChanged: handleDeskChanged,
    });
    const ticketCounts = useMemo(() => {
      const map = new Map<string, number>();
      if (activeId) map.set(activeId, createdHere.length);
      return map;
    }, [activeId, createdHere.length]);

    const {
      containerRef,
      panelState,
      setPanelState,
      isMobile,
      isDragging,
      startDrag,
      resetPanelRatio,
      panelWidthPx,
    } = usePanelLayout({
      projectId,
      conversations,
      activeId,
      setActiveId,
    });

    const hasActiveAgents = conversations.some(
      (conversation) => isLegacyConversationGenerating(conversation.status),
    );

    // Only poll conversation status while the panel is visible.
    usePolling(refreshConversations, 3000, panelState !== "hidden", { immediate: false });

    const createAndSelect = useCallback(
      async (options: { type: string; label: string }) => {
        const created = await createConversation(options);
        if (created) setActiveId(created.id);
        return created;
      },
      [createConversation, setActiveId],
    );

    const openChatConversation = useCallback(async () => {
      setPanelState("expanded");

      if (activeId) {
        return;
      }

      // An empty list is also what the mount fetch leaves behind while it is
      // still in flight. Creating from it made a second, permanent "Brainstorm"
      // next to the one the project already had whenever the strip was clicked
      // before the fetch landed. Only the hook's own `loading` tells the two
      // states apart: the click is honoured (the panel is open) and the hook
      // selects the first row itself once the payload arrives.
      if (conversationsLoading) {
        return;
      }

      if (conversations.length > 0) {
        setActiveId(conversations[0].id);
        return;
      }

      await createAndSelect({ type: BRAINSTORM_AGENT_TYPE, label: BRAINSTORM_CONVERSATION_LABEL });
    }, [
      activeId,
      conversationsLoading,
      conversations,
      setActiveId,
      setPanelState,
      createAndSelect,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        openNewEpic() {
          setPanelState("expanded");
          void createAndSelect({
            type: EPIC_CREATION_AGENT_TYPE,
            label: EPIC_CREATION_CONVERSATION_LABEL,
          });
        },
      }),
      [createAndSelect, setPanelState],
    );

    useEffect(() => {
      function onEscape(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        // Already handled below: the rename field cancels its edit, a Radix
        // dialog (the delete confirmation) dismisses itself. Collapsing too
        // would unmount the very thing the key was meant for.
        if (event.defaultPrevented) return;
        if (panelState !== "expanded") return;
        setPanelState("collapsed");
      }

      window.addEventListener("keydown", onEscape);
      return () => window.removeEventListener("keydown", onEscape);
    }, [panelState, setPanelState]);

    // Board seam: the Released digest hides while the panel eats board width.
    useEffect(() => {
      onExpandedChange?.(panelState === "expanded" && !isMobile);
    }, [panelState, isMobile, onExpandedChange]);

    const chatWorkspace = (
      <div
        data-testid="unified-chat-workspace"
        className="flex h-full min-h-0 flex-col gap-[10px] px-[14px] py-[12px]"
      >
        <ConversationRoster
          variant="compact"
          conversations={conversations}
          activeId={activeId}
          project={project}
          agentLabels={agentLabels}
          ticketCounts={ticketCounts}
          onSelect={setActiveId}
          onCreate={(options) => void createAndSelect(options)}
          createDisabled={conversationsLoading || mutating}
          onRestartPersistentSession={(conversationId) =>
            void restartPersistentSession(conversationId)
          }
          onRename={(conversationId, label) =>
            void renameConversation(conversationId, label).then((outcome) => {
              if (outcome === "busy") onToast("error", t("roster.renameNotSaved"));
            })
          }
          renameDisabled={renameDisabled}
          onDelete={(conversationId) => deleteConversation(conversationId)}
        />

        <ChatThread
          conversationId={activeId}
          projectId={projectId}
          messages={messages}
          loading={loading}
          sending={sending}
          streamStatus={streamStatus}
          agentLabel={activeAgentLabel}
          sendStartedAt={sendStartedAt}
          epicsByMessage={epicsByMessage}
          epicIdByMessage={resolvedEpicByMessage}
          resolveTicket={resolveTicket}
          tone={projectTone(project?.colorIndex ?? 0)}
          namedAgentId={activeConversation?.namedAgentId ?? null}
          onEpicCreated={recordEpicBinding}
          onOpenTicket={onOpenTicket}
          onToast={onToast}
          error={error}
          pendingQuestions={pendingQuestions}
          onAnswerQuestions={answerQuestions}
          busy={busy}
          emptyMessage={isEpicCreation ? t("thread.emptyEpic") : t("thread.emptyBrainstorm")}
          footer={
            <>
              <ChatNextSteps
                showDraftEpic={isEpicCreation && hasUserMessage && epicsByMessage.size === 0}
                drafting={epicDrafting}
                onDraftEpic={() => void draftEpic()}
                showGenerateSpec={isBrainstorm}
                generatingSpec={generatingSpec}
                onGenerateSpec={() => void generateSpec()}
                disabled={actionsDisabled}
              />
              {/* The generation used to end in a bare router.refresh(): say
                  what landed, and point at the spec only when one was written
                  (an epics-only answer leaves it untouched). */}
              {specResult ? (
                <div
                  role="status"
                  data-testid="chat-spec-generated"
                  className="flex flex-wrap items-baseline gap-x-2 px-2 pt-1 text-[12px] text-muted-foreground"
                >
                  <span>
                    {specResult.spec === null
                      ? t("thread.generateSpecEpicsOnly", { count: specResult.epicsCreated })
                      : t("thread.generateSpecDone", { count: specResult.epicsCreated })}
                  </span>
                  {specResult.spec !== null ? (
                    <QuietLink href={`/projects/${projectId}/spec`} tone="muted" size={12}>
                      {t("thread.viewSpec")}
                    </QuietLink>
                  ) : null}
                </div>
              ) : null}
            </>
          }
        />

        <ChatComposer
          projectId={projectId}
          conversationId={activeId}
          agentSelection={activeAgentSelection}
          onSelectAgent={selectAgent}
          agentLocked={agentLocked}
          attachmentsDisabled={attachmentsDisabled}
          disabled={busy || !activeConversation}
          onSend={sendMessage}
        />
      </div>
    );

    if (panelState === "expanded") {
      // On mobile the panel becomes a full-width Sheet. It must not fall
      // through to the desktop split below the breakpoint: the width clamps
      // there assume a container of ~706px+ and would compute an unusable
      // panel width (or a negative one).
      if (isMobile) {
        return (
          <div ref={containerRef} className="relative h-full w-full overflow-hidden">
            <div className="h-full w-full">{children}</div>
            <Sheet
              open
              onOpenChange={(open) => {
                if (open) return;
                // Mirrors the desktop Escape handling: dismissing collapses.
                setPanelState("collapsed");
              }}
            >
              <SheetContent
                side="right"
                showCloseButton={false}
                className="w-full max-w-none p-0 sm:max-w-none"
                data-testid="unified-panel-mobile-sheet"
                // Radix listens for Escape on the document in the CAPTURE
                // phase, before any React handler inside the sheet can stop
                // it. A field that owns Escape (the inline rename cancels its
                // edit with it) must not also dismiss the whole panel.
                onEscapeKeyDown={(event) => {
                  const target = event.target;
                  if (target instanceof Element && target.closest("[data-owns-escape]")) {
                    event.preventDefault();
                  }
                }}
              >
                {chatWorkspace}
              </SheetContent>
            </Sheet>
          </div>
        );
      }

      const panelWidth = panelWidthPx;
      const boardWidthStyle = {
        width: `calc(100% - ${panelWidth}px - ${DIVIDER_WIDTH}px)`,
      };

      return (
        <div ref={containerRef} className="flex h-full w-full overflow-hidden">
          <div
            className="h-full min-w-[400px] overflow-hidden"
            style={boardWidthStyle}
          >
            {children}
          </div>

          <button
            type="button"
            aria-label={t("panel.resize")}
            data-testid="panel-divider"
            onMouseDown={startDrag}
            onDoubleClick={resetPanelRatio}
            className={cn(
              "h-full w-[6px] shrink-0 border-l border-r border-border bg-band transition-colors",
              isDragging ? "bg-primary/30" : "hover:bg-primary/20",
            )}
          />

          <aside
            className="h-full min-h-0 shrink-0 border-l border-border bg-card transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: panelWidth }}
            data-testid="unified-panel-expanded"
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-end gap-[2px] border-b border-border px-[18px] py-[10px]">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-meta"
                  onClick={() => setPanelState("collapsed")}
                  aria-label={t("panel.collapse")}
                >
                  <PanelRightClose className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-meta"
                  onClick={() => setPanelState("hidden")}
                  aria-label={t("panel.hide")}
                >
                  <EyeOff className="h-4 w-4" />
                </Button>
              </div>

              <div className="min-h-0 flex-1">{chatWorkspace}</div>
            </div>
          </aside>
        </div>
      );
    }

    if (panelState === "collapsed") {
      return (
        <div ref={containerRef} className="flex h-full w-full overflow-hidden">
          <div className="h-full min-w-0 flex-1 overflow-hidden">{children}</div>

          <button
            type="button"
            onClick={() => void openChatConversation()}
            className={cn(
              "relative flex h-full w-[44px] shrink-0 items-center justify-center border-l border-border bg-card text-meta transition-colors hover:bg-band hover:text-foreground",
              hasActiveAgents && "bg-agent-bg text-agent",
            )}
            aria-label={t("panel.open")}
            data-testid="collapsed-chat-strip"
          >
            <span className="flex flex-col items-center gap-2 text-[11.5px] font-medium uppercase tracking-[0.14em] [writing-mode:vertical-rl]">
              <MessageSquare className="h-4 w-4 [writing-mode:horizontal-tb]" />
              {t("panel.stripLabel")}
            </span>
            {hasActiveAgents && (
              <span
                data-testid="collapsed-active-badge"
                className="breathing-dot absolute top-[8px] right-[8px] h-2 w-2"
              />
            )}
          </button>
        </div>
      );
    }

    return (
      <div ref={containerRef} className="relative h-full w-full overflow-hidden">
        <div className="h-full w-full">{children}</div>

        <button
          type="button"
          onClick={() => setPanelState("collapsed")}
          className="absolute right-2 top-2 z-30 rounded-full border border-border bg-card p-1.5 text-meta shadow-[0_1px_2px_rgba(36,33,29,.04)] hover:text-foreground"
          aria-label={t("panel.showStrip")}
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </div>
    );
  },
);
