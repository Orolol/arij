"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  EyeOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ChatTabBar } from "@/components/chat/ChatTabBar";
import { ChatWorkspaceHeader } from "@/components/chat/ChatWorkspaceHeader";
import { MessageList } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";
import { QuestionCards } from "@/components/chat/QuestionCards";
import { useConversations } from "@/hooks/useConversations";
import { usePanelLayout, DIVIDER_WIDTH, type UnifiedPanelState } from "@/hooks/usePanelLayout";
import { usePolling } from "@/hooks/usePolling";
import { useChat } from "@/hooks/useChat";
import { useEpicCreate } from "@/hooks/useEpicCreate";
import { useSpecGeneration } from "@/hooks/useSpecGeneration";
import {
  isBrainstormConversationAgentType,
  isEpicCreationConversationAgentType,
} from "@/lib/chat/conversation-agent";
import {
  isLegacyConversationGenerating,
  sortConversationsForLegacyParity,
} from "@/lib/chat/parity-contract";
import { cn } from "@/lib/utils";

export type { UnifiedPanelState };

export interface UnifiedChatPanelHandle {
  openChat: () => void;
  openNewEpic: () => void;
  collapse: () => void;
  hide: () => void;
}

interface UnifiedSharedPanelView {
  panelId: string;
  label: string;
  content: ReactNode;
  onClose?: () => void;
}

interface UnifiedChatPanelProps {
  projectId: string;
  children: ReactNode;
  onEpicCreated?: () => void;
  sharedPanelView?: UnifiedSharedPanelView | null;
}

export const UnifiedChatPanel = forwardRef<UnifiedChatPanelHandle, UnifiedChatPanelProps>(
  function UnifiedChatPanel({ projectId, children, onEpicCreated, sharedPanelView }, ref) {
    const router = useRouter();
    const [activePanelContent, setActivePanelContent] = useState<"chat" | "shared">("chat");
    const [, forceConversationRefresh] = useState(0);
    const previousSharedPanelIdRef = useRef<string | null>(null);

    const {
      conversations,
      activeId,
      setActiveId,
      createConversation,
      deleteConversation,
      updateConversation,
      refresh: refreshConversations,
    } = useConversations(projectId);

    const {
      messages,
      loading,
      sending,
      error: chatError,
      pendingQuestions,
      streamStatus,
      sendMessage: rawSendMessage,
      answerQuestions,
    } = useChat(projectId, activeId);

    const hasSharedPanelView = Boolean(sharedPanelView);
    const isSharedPanelActive = hasSharedPanelView && activePanelContent === "shared";
    const panelContentMode = isSharedPanelActive ? "shared" : "chat";

    const {
      containerRef,
      panelState,
      setPanelState,
      isMobile,
      isDragging,
      startDrag,
      resetPanelRatio,
      panelWidthPx,
      detailPanelWidthPx,
    } = usePanelLayout({
      projectId,
      dragTargetsChat: panelContentMode === "chat",
      conversations,
      activeId,
      setActiveId,
    });

    const activeConversation = useMemo(
      () => conversations.find((conversation) => conversation.id === activeId) || null,
      [conversations, activeId],
    );

    const tabConversations = useMemo(
      () => sortConversationsForLegacyParity(conversations),
      [conversations],
    );

    const { createEpic, isLoading: epicCreating, error: epicError } = useEpicCreate({
      projectId,
      conversationId: activeId,
      sendMessage: rawSendMessage,
    });

    const activeProvider = activeConversation?.provider || "claude-code";

    const {
      generateSpec,
      generating: generatingSpec,
      error: specError,
    } = useSpecGeneration(projectId, activeProvider);

    const hasMessages = messages.length > 0;
    const isBrainstorm = isBrainstormConversationAgentType(activeConversation?.type);
    const isEpicCreation = isEpicCreationConversationAgentType(activeConversation?.type);
    const hasUserMessage = messages.some((message) => message.role === "user");
    const canCreateEpic = isEpicCreation && hasUserMessage;
    const hasActiveAgents = conversations.some(
      (conversation) => isLegacyConversationGenerating(conversation.status),
    );
    // The *current* conversation is busy when useChat is actively streaming
    // OR when the DB status says "generating" (e.g. the user switched away and back).
    const isCurrentConversationBusy =
      sending || isLegacyConversationGenerating(activeConversation?.status);

    const previousSending = useRef(sending);
    useEffect(() => {
      if (previousSending.current && !sending) {
        const timer = setTimeout(() => refreshConversations(), 3000);
        return () => clearTimeout(timer);
      }
      previousSending.current = sending;
    }, [sending, refreshConversations]);

    // Only poll conversation status while the panel is visible.
    usePolling(refreshConversations, 3000, panelState !== "hidden", { immediate: false });

    useEffect(() => {
      if (!tabConversations.length) return;

      if (!activeId) {
        setActiveId(tabConversations[0].id);
        return;
      }

      if (!tabConversations.some((conversation) => conversation.id === activeId)) {
        setActiveId(tabConversations[0].id);
      }
    }, [activeId, setActiveId, tabConversations]);

    const createNewConversationTab = useCallback(
      async (options?: { type?: string; label?: string }) => {
        const created = await createConversation({
          type: options?.type || "brainstorm",
          label: options?.label || "Brainstorm",
        });

        if (created) {
          setActiveId(created.id);
          forceConversationRefresh((value) => value + 1);
        }

        return created;
      },
      [createConversation, setActiveId],
    );

    const openChatConversation = useCallback(async () => {
      setActivePanelContent("chat");
      setPanelState("expanded");

      if (activeId) {
        return;
      }

      if (tabConversations.length > 0) {
        const fallbackId = tabConversations[0].id;
        setActiveId(fallbackId);
        return;
      }

      await createNewConversationTab({ type: "brainstorm", label: "Brainstorm" });
    }, [activeId, tabConversations, setActiveId, setPanelState, createNewConversationTab]);

    useImperativeHandle(
      ref,
      () => ({
        openChat() {
          void openChatConversation();
        },
        openNewEpic() {
          setActivePanelContent("chat");
          setPanelState("expanded");
          void createNewConversationTab({ type: "epic_creation", label: "New Epic" });
        },
        collapse() {
          setPanelState("collapsed");
        },
        hide() {
          setPanelState("hidden");
        },
      }),
      [openChatConversation, createNewConversationTab, setPanelState],
    );

    useEffect(() => {
      const nextSharedPanelId = sharedPanelView?.panelId ?? null;
      const previousSharedPanelId = previousSharedPanelIdRef.current;

      if (!nextSharedPanelId) {
        if (previousSharedPanelId && activePanelContent === "shared") {
          setActivePanelContent("chat");
          setPanelState("collapsed");
        }
        previousSharedPanelIdRef.current = null;
        return;
      }

      if (previousSharedPanelId !== nextSharedPanelId) {
        setActivePanelContent("shared");
        setPanelState("expanded");
      }

      previousSharedPanelIdRef.current = nextSharedPanelId;
    }, [activePanelContent, sharedPanelView, setPanelState]);

    useEffect(() => {
      function onEscape(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        if (panelState !== "expanded") return;

        if (panelContentMode === "shared") {
          sharedPanelView?.onClose?.();
          return;
        }

        setPanelState("collapsed");
      }

      window.addEventListener("keydown", onEscape);
      return () => window.removeEventListener("keydown", onEscape);
    }, [panelContentMode, panelState, setPanelState, sharedPanelView]);

    const sendMessage = useCallback(
      async (content: string, attachmentIds: string[]) => {
        if (!activeId) return;
        await rawSendMessage(content, attachmentIds);
      },
      [activeId, rawSendMessage],
    );

    async function handleAgentChange(namedAgentId: string) {
      if (!activeId || hasMessages) {
        return;
      }
      await updateConversation(activeId, { namedAgentId });
    }

    async function handleCreateEpic() {
      const epicId = await createEpic();
      if (epicId) {
        onEpicCreated?.();
        router.refresh();
      }
    }

    async function closeTab(conversationId: string) {
      if (tabConversations.length <= 1) {
        return;
      }
      await deleteConversation(conversationId);
      forceConversationRefresh((value) => value + 1);
    }

    const chatWorkspace = (
      <div className="flex h-full flex-col">
        <ChatTabBar
          conversations={tabConversations}
          activeId={activeId}
          onSelectTab={setActiveId}
          onCloseTab={(conversationId) => void closeTab(conversationId)}
          onCreateTab={(options) => void createNewConversationTab(options)}
        />

        <ChatWorkspaceHeader
          activeConversation={activeConversation}
          activeProvider={activeProvider}
          hasMessages={hasMessages}
          isBusy={isCurrentConversationBusy}
          onAgentChange={handleAgentChange}
          showGenerateSpec={isBrainstorm}
          generatingSpec={generatingSpec}
          onGenerateSpec={generateSpec}
          showCreateEpic={canCreateEpic}
          epicCreating={epicCreating}
          onCreateEpic={handleCreateEpic}
        />

        {(epicError || specError || chatError) && (
          <div className="mx-3 mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {epicError || specError || chatError}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {isEpicCreation && !hasMessages && !loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Describe your epic idea and I&apos;ll help you structure it with user stories and acceptance criteria.
            </div>
          )}
          <MessageList
            messages={messages}
            loading={loading}
            streamStatus={streamStatus}
          />
          {pendingQuestions && (
            <div className="px-3 pb-3">
              <QuestionCards
                questions={pendingQuestions}
                onSubmit={answerQuestions}
                disabled={isCurrentConversationBusy}
              />
            </div>
          )}
        </div>

        <MessageInput
          projectId={projectId}
          onSend={sendMessage}
          disabled={isCurrentConversationBusy || !activeConversation}
          placeholder={isEpicCreation ? "Describe your epic idea..." : "Ask a question..."}
        />
      </div>
    );

    if (panelState === "expanded") {
      if (isMobile && panelContentMode === "chat") {
        return (
          <div ref={containerRef} className="relative h-full w-full overflow-hidden">
            <div className="h-full w-full">{children}</div>
            <Sheet
              open
              onOpenChange={(open) => {
                if (!open) {
                  setPanelState("collapsed");
                }
              }}
            >
              <SheetContent
                side="right"
                showCloseButton={false}
                className="w-full max-w-none p-0 sm:max-w-none"
                data-testid="unified-panel-mobile-sheet"
              >
                {chatWorkspace}
              </SheetContent>
            </Sheet>
          </div>
        );
      }

      const boardWidthStyle =
        panelContentMode === "shared"
          ? { width: `calc(100% - ${detailPanelWidthPx}px)` }
          : { width: `calc(100% - ${panelWidthPx}px - ${DIVIDER_WIDTH}px)` };
      const panelWidthStyle =
        panelContentMode === "shared" ? detailPanelWidthPx : panelWidthPx;

      return (
        <div ref={containerRef} className="flex h-full w-full overflow-hidden">
          <div
            className={cn(
              "h-full overflow-hidden",
              panelContentMode === "shared" ? "min-w-0" : "min-w-[400px]",
            )}
            style={boardWidthStyle}
          >
            {children}
          </div>

          {panelContentMode === "chat" && (
            <button
              type="button"
              aria-label="Resize panel"
              data-testid="panel-divider"
              onMouseDown={startDrag}
              onDoubleClick={resetPanelRatio}
              className={cn(
                "h-full w-[6px] shrink-0 border-l border-r border-border/60 bg-muted/60 transition-colors",
                isDragging ? "bg-primary/30" : "hover:bg-primary/20",
              )}
            />
          )}

          <aside
            className="h-full shrink-0 border-l border-border bg-background/95 backdrop-blur transition-all duration-200"
            style={{ width: panelWidthStyle }}
            data-testid={
              panelContentMode === "shared"
                ? "unified-panel-shared"
                : "unified-panel-expanded"
            }
          >
            <div className="flex h-10 items-center justify-between gap-1 border-b border-border px-2">
              <div className="flex items-center gap-1">
                {hasSharedPanelView && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant={panelContentMode === "chat" ? "secondary" : "ghost"}
                      onClick={() => setActivePanelContent("chat")}
                      className="h-7 px-2 text-xs"
                    >
                      Chat
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={panelContentMode === "shared" ? "secondary" : "ghost"}
                      onClick={() => setActivePanelContent("shared")}
                      className="h-7 px-2 text-xs"
                    >
                      {sharedPanelView?.label ?? "Details"}
                    </Button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1">
                {panelContentMode === "shared" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => sharedPanelView?.onClose?.()}
                    aria-label="Close detail panel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPanelState("collapsed")}
                      aria-label="Collapse panel"
                    >
                      <PanelRightClose className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPanelState("hidden")}
                      aria-label="Hide panel"
                    >
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="h-[calc(100%-2.5rem)]">
              {panelContentMode === "shared" ? sharedPanelView?.content : chatWorkspace}
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
              "relative h-full w-14 shrink-0 flex items-center justify-center border-l border-border bg-muted/60 text-muted-foreground backdrop-blur transition-colors hover:bg-muted/80 hover:text-foreground",
              hasActiveAgents && "bg-primary/10 shadow-[-6px_0_24px_rgba(59,130,246,0.25)]",
            )}
            aria-label="Open chat panel"
            data-testid="collapsed-chat-strip"
          >
            <span className="flex flex-col items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em]">
              <MessageSquare className="h-4 w-4" />
              Chat
            </span>
            {hasActiveAgents && (
              <span
                data-testid="collapsed-active-badge"
                className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-primary animate-pulse"
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
          className="absolute right-2 top-2 z-30 rounded-full border border-border bg-background/95 p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
          aria-label="Show chat strip"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </div>
    );
  },
);
