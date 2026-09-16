"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { projectTone } from "@/components/piscine";
import { ToastStack } from "@/components/toast/ToastStack";
import { useToastStack } from "@/components/toast/useToastStack";
import { useTicketOverlay } from "@/components/ticket/TicketOverlayProvider";
import { useControlDesk } from "@/hooks/useControlDesk";
import { usePolling } from "@/hooks/usePolling";
import type { ControlDeskPayload, DeskProject } from "@/lib/control-desk/types";
import { cn } from "@/lib/utils";
import { requestJson } from "@/lib/api/client";

import type { AgentSelection } from "@/components/shared/AgentSelectPill";
import { useChatWorkspace } from "@/hooks/useChatWorkspace";
import { ChatComposer } from "./ChatComposer";
import {
  ChatPaneSwitcher,
  DEFAULT_CHAT_PANE,
  chatPaneClass,
  type ChatPane,
} from "./ChatPaneSwitcher";
import { ChatNextSteps } from "./ChatNextSteps";
import { ChatThread } from "./ChatThread";
import { ContextRail } from "./ContextRail";
import { ConversationRoster } from "./ConversationRoster";
import { CreatedHereCard } from "./CreatedHereCard";
import { TowardSpecBand } from "./TowardSpecBand";
import { useChatContextTokens } from "./chat-context-tokens";
import { useConversationAgentLabels } from "./useConversationAgentLabels";
import { useThreadEpics } from "./useThreadEpics";

/**
 * Frame 11a — Chat as a full page.
 *
 * Three columns: the conversation roster, the thread + composer, and the
 * context rail. A conversation with a named agent produces TICKETS, and the
 * ticket it produces appears in the thread itself as an actionable card, with
 * no detour through the board.
 *
 * THREE COLUMNS FROM `lg`, ONE PANE BELOW IT (B-arij-180). Both flanks were
 * `w-[300px] shrink-0` with no breakpoint, so a 390px phone was asked to fit
 * 600px of fixed columns plus the thread: the roster took the screen and the
 * thread, the composer and the rail were off it. Below `lg` the page stacks
 * into a single pane with `ChatPaneSwitcher` above it; the panes are hidden,
 * never unmounted, and `lg:flex` puts all three back with no state to restore.
 * The switcher is `lg:hidden`, so the desktop frame is unchanged.
 *
 * NO 60px HEADER: `components/piscine/TopBar` is mounted once by
 * `app/layout.tsx` and owns the logo, the project chips, ⌘K, the inbox, Auto
 * and "New". This page starts at its own three-column body. It also has no
 * second control row — the frame draws exactly one per-screen control, the
 * project pill inside the composer, and that pill IS the scope control.
 *
 * ESCAPE DOES NOTHING HERE. The panel this replaces collapsed itself on
 * Escape; there is no panel on a page, and `TicketOverlayProvider` owns Escape
 * while a ticket is open. No page-level handler is registered on purpose.
 */
export interface ChatPageViewProps {
  /** `?project=` — the top bar's chips link this way. */
  initialProjectId?: string;
  /** `?conversation=` — a deep link to one conversation. */
  initialConversationId?: string;
}

export function ChatPageView({
  initialProjectId,
  initialConversationId,
}: ChatPageViewProps) {
  const { openTicket } = useTicketOverlay();

  /*
    ONE cross-project read, at 8s. The desk polls itself at 4s because it is a
    supervision screen; this one needs the project list, the readable ids and
    the queue ranks, none of which move that fast.
  */
  const { data: desk, refresh: refreshDesk } = useControlDesk(null, 8000);
  const projects: readonly DeskProject[] = useMemo(
    () => desk?.projects ?? [],
    [desk],
  );

  const [chosenProjectId, setChosenProjectId] = useState<string | null>(
    initialProjectId ?? null,
  );
  /*
    A new `initialProjectId` — a deep link arriving while the page is already
    mounted — wins over the local pick. Adjusted during render rather than from
    an effect so the first paint after the link is the requested project, not
    one commit of the previous one.

    Only a CHANGE applies, and only a truthy one: navigating to the bare /chat
    route drops the param, and that must leave the current pick alone rather
    than snapping back to the first project.
  */
  const [lastInitialProjectId, setLastInitialProjectId] =
    useState(initialProjectId);
  if (initialProjectId !== lastInitialProjectId) {
    setLastInitialProjectId(initialProjectId);
    if (initialProjectId) setChosenProjectId(initialProjectId);
  }

  const activeProjectId =
    chosenProjectId && projects.some((row) => row.id === chosenProjectId)
      ? chosenProjectId
      : (chosenProjectId ?? projects[0]?.id ?? null);
  const project =
    projects.find((row) => row.id === activeProjectId) ?? null;
  const tone = projectTone(project?.colorIndex ?? 0);

  const { toasts, raise, dismiss } = useToastStack();

  return (
    <div
      data-testid="chat-page"
      className="flex h-full min-h-0 w-full flex-col bg-background font-sans text-foreground"
    >
      {activeProjectId ? (
        <ChatWorkspace
          // Remounting on a project switch is the point: conversations, the
          // thread, the staged attachments and the per-conversation epic map
          // all belong to ONE project and must not leak across a change.
          key={activeProjectId}
          projectId={activeProjectId}
          projects={projects}
          project={project}
          tone={tone}
          desk={desk}
          initialConversationId={initialConversationId}
          onSelectProject={setChosenProjectId}
          onToast={raise}
          onDeskChanged={refreshDesk}
          openTicket={openTicket}
        />
      ) : (
        <EmptyChatWorkspace />
      )}

      <ToastStack items={toasts} onDismiss={dismiss} testId="chat-toast" />
    </div>
  );
}

/** No conversation to run: the pill names nothing rather than a default. */
const EMPTY_AGENT_SELECTION: AgentSelection = {
  namedAgentId: null,
  provider: null,
};

/**
 * The page body, shared by the empty state and the real workspace.
 *
 * A COLUMN THAT BECOMES A ROW. Below `lg` the switcher sits on top of one
 * full-width pane; from `lg` the three columns share one row exactly as they
 * always have — `lg:gap-3` restores the 12px the frame draws, and the switcher
 * is `display: none` so it costs the row nothing.
 */
const CHAT_BODY_CLASS =
  "flex min-h-0 flex-1 flex-col gap-[10px] px-[14px] pt-[14px] pb-[14px] lg:flex-row lg:gap-3";

/**
 * The middle pane. `tabIndex={-1}` is not decoration: picking a conversation
 * on a phone destroys the pane holding the card you just tapped, and without
 * somewhere to put focus it would fall to `<body>`.
 *
 * AND THAT HAND-OFF IS A KEYBOARD EVENT, so the pane owes a ring (B-arij-231).
 * `outline-none` alone made the destination of that focus invisible. Measured
 * in Chrome at 390x844 on the unfixed tree, tabbing to a roster card and
 * pressing Enter (`e2e/chat-thread-pane-focus.spec.ts` re-measures it):
 *
 *   activeElement          chat-thread-pane
 *   matches(":focus-visible")  true
 *   outline-style          none      <- nothing drawn, focus went nowhere visible
 *
 * The pane is NOT the TicketOverlay case that `NO_AFFORDANCE_NEEDED` exempts.
 * It never enters the Tab order (30 presses at 390, 40 at 1440: never reached)
 * and it is not a scroll container (`overflow: visible`, `scrollHeight ===
 * clientHeight`, the transcript scrolls inside a Radix viewport further down),
 * so no browser tabs to it on its own. But it IS the target of a keyboard
 * hand-off, and `:focus-visible` matches exactly then — never after a tap,
 * where the same measurement reads `false` and this ring stays unpainted.
 *
 * ONE LITERAL, on one line, deliberately: `__tests__/helpers/class-list-scan.ts`
 * resolves a `const NAME = "…"` into its use sites only for a plain string or a
 * no-substitution template. Splitting this across a `+` would take the whole
 * class list out of the scan — and the rule would then pass because it no
 * longer SEES the pane, which is the one failure mode this fix must not create.
 */
const THREAD_PANE_CLASS = "min-h-0 min-w-0 flex-1 flex-col gap-[10px] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The right rail. `overflow-y-auto` belongs to the stacked layout, where the
 * pane owns the full height and its three bands can exceed it; from `lg` the
 * column behaves exactly as before.
 */
const CONTEXT_PANE_CLASS =
  "min-h-0 w-full flex-1 flex-col gap-[10px] overflow-y-auto lg:w-[300px] lg:flex-none lg:overflow-y-visible";

/**
 * The page with no project to scope to — while the desk read is in flight, or
 * because the database has none.
 *
 * Every band collapses to its label line and the composer is disabled with an
 * em-dash project pill. NO fake project, no spinner sentence: the empty state
 * is the screen's own shape with nothing in it.
 */
function EmptyChatWorkspace() {
  const emptyTokens = useMemo(
    () => ({ spec: null, memory: null, citedDocs: [] }),
    [],
  );
  const [pane, setPane] = useState<ChatPane>(DEFAULT_CHAT_PANE);

  return (
    <div className={CHAT_BODY_CLASS}>
      <ChatPaneSwitcher pane={pane} onChange={setPane} />

      <ConversationRoster
        conversations={[]}
        activeId={null}
        project={null}
        agentLabels={new Map()}
        ticketCounts={new Map()}
        onSelect={() => {}}
        onCreate={() => {}}
        onRestartPersistentSession={() => {}}
        createDisabled
        className={chatPaneClass(pane, "conversations")}
      />
      <div
        data-testid="chat-thread-pane"
        className={cn(THREAD_PANE_CLASS, chatPaneClass(pane, "thread"))}
      >
        <div className="min-h-0 flex-1" />
        <ChatComposer
          projectId={null}
          projects={[]}
          project={null}
          onSelectProject={() => {}}
          agentSelection={EMPTY_AGENT_SELECTION}
          onSelectAgent={() => {}}
          agentLocked
          disabled
          onSend={() => {}}
        />
      </div>
      <div
        data-testid="chat-context"
        className={cn(CONTEXT_PANE_CLASS, chatPaneClass(pane, "context"))}
      >
        <ContextRail tokens={emptyTokens} />
        <CreatedHereCard entries={[]} tone={1} onOpenTicket={() => {}} />
        <TowardSpecBand available={false} pending={false} onPropose={() => {}} />
      </div>
    </div>
  );
}

interface ChatWorkspaceProps {
  projectId: string;
  projects: readonly DeskProject[];
  project: DeskProject | null;
  tone: ReturnType<typeof projectTone>;
  desk: ControlDeskPayload | null;
  initialConversationId?: string;
  onSelectProject: (projectId: string) => void;
  onToast: (tone: "success" | "error", message: string) => void;
  onDeskChanged: () => void;
  openTicket: (epicId: string, options?: { projectId?: string | null }) => void;
}

function ChatWorkspace({
  projectId,
  projects,
  project,
  tone,
  desk,
  initialConversationId,
  onSelectProject,
  onToast,
  onDeskChanged,
  openTicket,
}: ChatWorkspaceProps) {
  const {
    conversations, activeId, setActiveId, conversationsLoading,
    createConversation, deleteConversation, restartPersistentSession, refreshConversations,
    renameConversation, renameDisabled,
    messages, loading, sending, error, pendingQuestions, streamStatus,
    sendMessage: handleSend, answerQuestions, activeConversation,
    activeAgentSelection, agentLocked, attachmentsDisabled,
    hasUserMessage, isBrainstorm, isEpicCreation, busy, sendStartedAt,
    selectAgent: handleSelectAgent, draftEpic,
    epicDrafting, generateSpec, generatingSpec, actionsDisabled, mutating,
  } = useChatWorkspace(projectId);

  const t = useTranslations("Chat");

  /* ---- conversation bookkeeping ---------------------------------------- */

  // The deep link only applies while the conversation it names still exists,
  // and only once: after that the user's own selection wins.
  const deepLinkApplied = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialConversationId) {
      deepLinkApplied.current = undefined;
      return;
    }
    if (deepLinkApplied.current === initialConversationId) return;
    if (!conversations.some((row) => row.id === initialConversationId)) return;
    deepLinkApplied.current = initialConversationId;
    setActiveId(initialConversationId);
  }, [conversations, initialConversationId, setActiveId]);

  usePolling(refreshConversations, 3000, true, { immediate: false });

  /* ---- who is talking, and the epics the thread drafted ---------------- */

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
    onDeskChanged,
  });

  const ticketCounts = useMemo(() => {
    const map = new Map<string, number>();
    // Only the ACTIVE conversation's messages are loaded, so it is the only
    // row whose count is knowable. The others simply omit the line rather than
    // printing a number this page did not measure.
    if (activeId) map.set(activeId, createdHere.length);
    return map;
  }, [activeId, createdHere.length]);

  /* ---- context rail ---------------------------------------------------- */

  const contextTokens = useChatContextTokens(projectId, messages);

  /* ---- which pane, on a viewport too narrow for three -------------------- */

  const [pane, setPane] = useState<ChatPane>(DEFAULT_CHAT_PANE);
  const threadPaneRef = useRef<HTMLDivElement>(null);
  const claimThreadFocus = useRef(false);

  // AFTER the commit that un-hides the pane, never during the click: focusing
  // a `display: none` element is a silent no-op, so this cannot be done in the
  // handler that asks for the switch.
  useEffect(() => {
    if (!claimThreadFocus.current) return;
    claimThreadFocus.current = false;
    threadPaneRef.current?.focus();
  }, [pane, activeId]);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      setActiveId(conversationId);
      // On a phone the card you just tapped belongs to the pane that is about
      // to disappear — show the conversation you chose, and take its focus
      // with it. `pane !== "thread"` IS the test for the stacked layout: the
      // switcher is `lg:hidden`, so a desktop session never leaves the thread
      // pane and nothing here moves focus away from the roster it clicked.
      if (pane !== "thread") {
        setPane("thread");
        claimThreadFocus.current = true;
      }
    },
    [pane, setActiveId],
  );

  /* ---- sending --------------------------------------------------------- */

  const hasAssistantMessage = messages.some(
    (message) => message.role === "assistant" && message.content.trim().length > 0,
  );

  const handleCreateConversation = useCallback(
    async (options: { type: string; label: string }) => {
      if (mutating || conversationsLoading) return;
      const created = await createConversation(options);
      if (created) handleSelectConversation(created.id);
    },
    [createConversation, mutating, conversationsLoading, handleSelectConversation],
  );

  /* ---- the TOWARD THE SPEC proposal ------------------------------------ */

  const [proposing, setProposing] = useState(false);
  const [specHref, setSpecHref] = useState<string | null>(null);

  const proposeSpecAddition = useCallback(async () => {
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.content.trim());
    if (!lastAssistant) return;

    setProposing(true);
    // AGENT-FACING, so it is NOT a catalogue key and never follows the
    // interface locale (lib/i18n/catalogue.ts, §5) — a model reads it, not a
    // user. Pinned to English for the same reason the prompt builders are:
    // the specification it is asking to edit is English, as is the project
    // memory injected alongside it, and a French instruction over English
    // context is exactly the mix that degrades the rewrite.
    const instruction = `Integrate into the spec the decision made in this conversation:\n${lastAssistant.content.slice(0, 4000)}`;
    const result = await requestJson(`/api/projects/${projectId}/spec/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
      errorMessage: t("towardSpec.proposalFailed"),
    });
    setProposing(false);
    if (result.error) {
      // 409 SPEC_UPDATE_PENDING and 400 (stale named agent) both carry a
      // readable `error`. Neither is retried: a second rewrite would race
      // the first, last-write-wins.
      onToast("error", result.error);
      return;
    }
    setSpecHref(`/projects/${projectId}/spec`);
    onToast("success", t("towardSpec.proposalSent"));
  }, [messages, projectId, onToast, t]);

  /* ---- next steps under the thread ------------------------------------ */

  // Generated from THIS conversation; say what landed and point at the spec,
  // the same way the "toward the spec" proposal does. An epics-only answer
  // left the spec untouched, so it neither claims a write nor links to it.
  async function handleGenerateSpec() {
    const outcome = await generateSpec();
    if (!outcome) return;
    if (outcome.spec === null) {
      onToast("success", t("thread.generateSpecEpicsOnly", { count: outcome.epicsCreated }));
    } else {
      setSpecHref(`/projects/${projectId}/spec`);
      onToast("success", t("thread.generateSpecDone", { count: outcome.epicsCreated }));
    }
    onDeskChanged();
  }

  const footer = (
    <ChatNextSteps
      showDraftEpic={isEpicCreation && hasUserMessage && epicsByMessage.size === 0}
      drafting={epicDrafting}
      onDraftEpic={() => void draftEpic()}
      showGenerateSpec={isBrainstorm}
      generatingSpec={generatingSpec}
      onGenerateSpec={() => void handleGenerateSpec()}
      disabled={actionsDisabled}
    />
  );

  const emptyMessage = isEpicCreation
    ? t("thread.emptyEpic")
    : t("thread.emptyBrainstorm");

  return (
    <div className={CHAT_BODY_CLASS}>
      <ChatPaneSwitcher pane={pane} onChange={setPane} />

      <ConversationRoster
        conversations={conversations}
        activeId={activeId}
        project={project}
        agentLabels={agentLabels}
        ticketCounts={ticketCounts}
        onSelect={handleSelectConversation}
        onCreate={handleCreateConversation}
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
        // Confirmed by the roster's PermanentDeleteDialog before it runs.
        onDelete={(conversationId) => deleteConversation(conversationId)}
        className={chatPaneClass(pane, "conversations")}
      />

      <div
        ref={threadPaneRef}
        data-testid="chat-thread-pane"
        tabIndex={-1}
        aria-label={t("thread.paneLabel")}
        className={cn(THREAD_PANE_CLASS, chatPaneClass(pane, "thread"))}
      >
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
          tone={tone}
          namedAgentId={activeConversation?.namedAgentId ?? null}
          onEpicCreated={recordEpicBinding}
          onOpenTicket={(epicId) => openTicket(epicId, { projectId })}
          onToast={onToast}
          error={error}
          pendingQuestions={pendingQuestions}
          onAnswerQuestions={answerQuestions}
          busy={busy}
          emptyMessage={emptyMessage}
          footer={footer}
        />

        <ChatComposer
          projectId={projectId}
          conversationId={activeId}
          projects={projects}
          project={project}
          onSelectProject={onSelectProject}
          agentSelection={activeAgentSelection}
          onSelectAgent={handleSelectAgent}
          agentLocked={agentLocked}
          attachmentsDisabled={attachmentsDisabled}
          disabled={busy || !activeConversation}
          onSend={handleSend}
        />
      </div>

      <div
        data-testid="chat-context"
        className={cn(CONTEXT_PANE_CLASS, chatPaneClass(pane, "context"))}
      >
        <ContextRail tokens={contextTokens} />
        <CreatedHereCard
          entries={createdHere}
          tone={tone}
          onOpenTicket={(epicId) => openTicket(epicId, { projectId })}
        />
        <TowardSpecBand
          available={hasAssistantMessage}
          pending={proposing}
          onPropose={() => void proposeSpecAddition()}
          specHref={specHref}
        />
      </div>
    </div>
  );
}
