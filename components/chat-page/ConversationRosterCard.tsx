"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  GhostInputPill,
  Mono,
  PillButton,
  SurfaceCard,
} from "@/components/piscine";
import type { Conversation } from "@/hooks/useConversations";
import { isPersistentChatProvider } from "@/lib/agent-config/constants";
import { normalizeLegacyConversationStatus, resolveLegacyConversationLabel } from "@/lib/chat/parity-contract";
import type { DeskProject } from "@/lib/control-desk/types";
import { formatRelative } from "@/lib/i18n/format";

/**
 * One row of the 300px conversation roster (frame 11a, left column).
 *
 * `SurfaceCard radius={14}` is not on offer — `SurfaceRadius` is 10 | 11 | 12 —
 * so the card takes `radius={12}` and the frame's 14 lands through `className`,
 * where twMerge keeps the later value. `selected` supplies the frame's 2px ink
 * border (the ONE 2px border on this screen) with no reflow.
 */
export interface ConversationRosterCardProps {
  conversation: Conversation;
  project: DeskProject | null;
  /** Resolved named agent / provider label. Never a raw id. */
  agentLabel: string;
  active: boolean;
  /** Epics this conversation has produced. The line is omitted at 0. */
  ticketCount: number;
  onSelect: () => void;
  /** Kill and re-warm the embedded CLI. Only for persistent providers. */
  onRestartPersistentSession?: () => void;
  /**
   * Save a new name. Offered on the ACTIVE card only: renaming is an edit of
   * the conversation you are in, not a bulk action over the list.
   */
  onRename?: (label: string) => void;
  /**
   * The host cannot take the write right now (a turn is running or another
   * conversation write is in flight). The pencil is disabled rather than
   * letting an edit be dropped silently on save.
   */
  renameDisabled?: boolean;
  /** Delete the conversation. The roster withholds it for the last row. */
  onDelete?: () => void;
  /** Injected in tests so the age does not depend on the wall clock. */
  now?: number;
}

export function ConversationRosterCard({
  conversation,
  project,
  agentLabel,
  active,
  ticketCount,
  onSelect,
  onRestartPersistentSession,
  onRename,
  renameDisabled = false,
  onDelete,
  now,
}: ConversationRosterCardProps) {
  const title = resolveLegacyConversationLabel(
    conversation.type,
    conversation.label,
  );
  const shortName = project?.shortName?.toUpperCase() ?? "—";
  const locale = useLocale();
  const t = useTranslations("Chat");
  // An unreadable timestamp is an em dash upstream of the join, never a guess.
  const age = formatRelative(conversation.createdAt, { locale, now }) || "—";
  const meta = `${shortName} · ${agentLabel} · ${age}`;

  const persistent = isPersistentChatProvider(conversation.provider);
  const hot = conversation.persistentSessionState === "hot";
  // The stream persists `error` on every failed turn and keeps it until the
  // next one; before this line a failed conversation looked exactly like a
  // healthy one. The state is a WORD (the icon only echoes it).
  const status = normalizeLegacyConversationStatus(conversation.status);

  const [draft, setDraft] = useState<string | null>(null);
  const editing = active && onRename !== undefined && draft !== null;
  // Enter and Escape unmount the focused field, and Chrome dispatches `blur`
  // on a focused element as it is removed. React then runs the PREVIOUS
  // render's onBlur, whose `draft` still holds the typed text: Escape would
  // save what it meant to drop, and Enter would save twice. The key handlers
  // settle the edit and raise this flag synchronously, before that blur.
  const settledRef = useRef(false);

  function startRename() {
    settledRef.current = false;
    setDraft(title);
  }

  function commitRename() {
    if (draft === null || settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    setDraft(null);
    if (next && next !== title) onRename?.(next);
  }

  function cancelRename() {
    settledRef.current = true;
    setDraft(null);
  }

  return (
    <SurfaceCard
      radius={12}
      interactive
      selected={active}
      data-testid="chat-roster-card"
      data-active={active ? "" : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
      className="flex flex-col gap-[5px] rounded-[14px] px-[15px] py-[13px]"
    >
      {editing ? (
        <div
          className="flex items-center"
          // Typing in the field must neither re-select the row nor let the
          // card's own Enter/Space handler swallow the keystroke.
          onClick={(event) => event.stopPropagation()}
        >
          <GhostInputPill
            value={draft}
            onChange={setDraft}
            placeholder={title}
            fill="card"
            width="flex"
            autoFocusKey={conversation.id}
            aria-label={t("roster.nameLabel")}
            data-testid="chat-roster-rename-field"
            // Hosts that dismiss on Escape (the mobile Sheet listens on the
            // document in the CAPTURE phase, before React sees the key) check
            // this marker and leave the key to the field.
            data-owns-escape=""
            maxLength={200}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                // preventDefault also tells the panel's window-level Escape
                // listener that this key was already handled here.
                event.preventDefault();
                cancelRename();
              }
            }}
          />
        </div>
      ) : (
        <div className="flex items-center gap-[6px]">
          <span className="line-clamp-1 min-w-0 flex-1 text-[13.5px] font-semibold">
            {title}
          </span>
          {(active && onRename) || onDelete ? (
            <div
              className="flex shrink-0 items-center gap-[4px]"
              onClick={(event) => event.stopPropagation()}
            >
              {active && onRename ? (
                <PillButton
                  variant="outline"
                  outlineTone="neutral"
                  iconOnly
                  icon={Pencil}
                  aria-label={t("roster.rename")}
                  className="h-[22px] w-[22px]"
                  disabled={renameDisabled}
                  onClick={startRename}
                >
                  {t("roster.rename")}
                </PillButton>
              ) : null}
              {onDelete ? (
                <PillButton
                  variant="outline"
                  outlineTone="neutral"
                  iconOnly
                  icon={X}
                  aria-label={t("roster.delete")}
                  className="h-[22px] w-[22px]"
                  onClick={onDelete}
                >
                  {t("roster.delete")}
                </PillButton>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <Mono size={10} tone="muted" clamp={1}>
        {meta}
      </Mono>

      {status === "generating" || status === "error" ? (
        <span
          data-testid="chat-roster-status"
          data-status={status}
          className="flex items-center gap-[5px] text-[12px] text-muted-foreground"
        >
          {status === "generating" ? (
            <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" />
          ) : (
            <AlertTriangle aria-hidden="true" className="h-3 w-3" />
          )}
          {status === "generating" ? t("roster.status.generating") : t("roster.status.error")}
        </span>
      ) : null}

      {active && ticketCount > 0 ? (
        // Never "0 tickets": an empty count is a line that does not exist.
        <span className="line-clamp-1 text-[12px] text-muted-foreground">
          {t("roster.ticketsCreated", { count: ticketCount })}
        </span>
      ) : null}

      {active && (persistent || conversation.cliSessionId) ? (
        <div
          className="flex items-center gap-2 pt-[2px]"
          // The card itself is the select target; the restart button inside it
          // must not also re-select the row it already belongs to.
          onClick={(event) => event.stopPropagation()}
        >
          {persistent ? (
            // Testid + wording carried over from ChatWorkspaceHeader: the state
            // is the WORD, never a colour.
            <span data-testid="persistent-session-state">
              <Mono size={10} tone="muted">
                {hot ? t("roster.sessionWarm") : t("roster.sessionCold")}
              </Mono>
            </span>
          ) : (
            <span data-testid="linked-session-state">
              <Mono size={10} tone="muted">
                {t("roster.sessionLinked")}
              </Mono>
            </span>
          )}
          {persistent && onRestartPersistentSession ? (
            // Deliberately NOT disabled while the conversation is busy: killing
            // the embedded CLI is the recovery for a wedged turn, and a wedged
            // turn is exactly when the row stays "generating".
            <PillButton
              variant="outline"
              outlineTone="neutral"
              iconOnly
              icon={RotateCcw}
              aria-label={t("roster.restartSession")}
              className="ml-auto h-[24px] w-[24px]"
              onClick={onRestartPersistentSession}
            >
              {t("roster.restartSession")}
            </PillButton>
          ) : null}
        </div>
      ) : null}
    </SurfaceCard>
  );
}
