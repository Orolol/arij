"use client";

import * as React from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { PermanentDeleteDialog } from "@/components/shared/PermanentDeleteDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveLegacyConversationLabel } from "@/lib/chat/parity-contract";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/hooks/useConversations";
import type { DeskProject } from "@/lib/control-desk/types";

import { ChatKnowsCard } from "./ChatKnowsCard";
import { ConversationRosterCard } from "./ConversationRosterCard";
import { NewConversationCard } from "./NewConversationCard";

/**
 * The 300px left column: conversations, the dashed "New conversation" card,
 * and the sunken "LE CHAT SAIT" note pinned to the bottom.
 *
 * 300px FROM `lg` ONLY. Below it the page is one pane at a time
 * (`ChatPaneSwitcher`) and the roster is that whole pane — a fixed 300px next
 * to a 300px rail is what pushed the thread off a 390px phone (B-arij-180).
 *
 * THE ROSTER IS SCOPED TO THE ACTIVE PROJECT, AND THAT IS NOT AN OVERSIGHT.
 * Frame 11a samples three rows across three projects. Listing conversations
 * cross-project means calling `GET /api/projects/:id/conversations` once per
 * project — and that route AUTO-CREATES a default "Brainstorm" conversation
 * when a project has none. Fanning it out would write a row into every project in the
 * database as the consequence of *looking at a page*, and a client-side filter
 * afterwards does not help: the write has already happened. Each row still
 * prints the mono `PROJECT · agent · when` line, so the shape matches the
 * frame; the project pill in the composer is what changes the scope.
 *
 * TWO VARIANTS, ONE LIST. `page` is the /chat column. `compact` is the same
 * roster inside the project side panel (`components/chat/UnifiedChatPanel`):
 * no 300px column, no "THE CHAT KNOWS" note, a capped height so the thread
 * keeps the panel. Both surfaces used to draw their own list (a tab bar on
 * the panel) and drifted apart on what a conversation could do.
 *
 * DELETE IS CONFIRMED. The delete X sits beside the rename pencil on a small
 * card; a one-click delete there loses a whole history on a missed aim, so it
 * goes through the shared PermanentDeleteDialog (the QuietDangerAction
 * contract: the confirmation is the caller's).
 */
export interface ConversationRosterProps {
  conversations: readonly Conversation[];
  activeId: string | null;
  project: DeskProject | null;
  /** conversation id → resolved agent label. */
  agentLabels: ReadonlyMap<string, string>;
  /** conversation id → epics produced by it. */
  ticketCounts: ReadonlyMap<string, number>;
  onSelect: (conversationId: string) => void;
  onCreate: (options: { type: string; label: string }) => void;
  onRestartPersistentSession: (conversationId: string) => void;
  /** Inline rename of the active conversation. Omit to hide the affordance. */
  onRename?: (conversationId: string, label: string) => void;
  /** The host cannot take a rename right now — see ConversationRosterCard. */
  renameDisabled?: boolean;
  /**
   * Delete a conversation, after the user confirmed. Never offered for the
   * last remaining row.
   */
  onDelete?: (conversationId: string) => Promise<unknown> | void;
  createDisabled?: boolean;
  variant?: "page" | "compact";
  now?: number;
  /** The host's pane visibility — see `chatPaneClass`. */
  className?: string;
}

export function ConversationRoster({
  conversations,
  activeId,
  project,
  agentLabels,
  ticketCounts,
  onSelect,
  onCreate,
  onRestartPersistentSession,
  onRename,
  renameDisabled = false,
  onDelete,
  createDisabled = false,
  variant = "page",
  now,
  className,
}: ConversationRosterProps) {
  const t = useTranslations("Chat");
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const compact = variant === "compact";
  const createCard = (
    <NewConversationCard onCreate={onCreate} disabled={createDisabled} />
  );

  async function confirmDelete() {
    if (!pendingDelete || !onDelete) return;
    setDeleting(true);
    // A failed delete is reported by the host (useConversations' error); the
    // dialog closes either way. No try/finally: the React Compiler bails on it.
    await Promise.resolve(onDelete(pendingDelete.id)).catch(() => undefined);
    setDeleting(false);
    setPendingDelete(null);
  }

  return (
    <div
      data-testid="chat-roster"
      data-variant={variant}
      className={cn(
        "flex min-h-0 w-full flex-col gap-[10px]",
        variant === "page"
          ? "flex-1 lg:w-[300px] lg:flex-none"
          : "max-h-[40%] shrink-0",
        className,
      )}
    >
      {/*
        On the page the list AND the create card scroll together — the frame
        draws the dashed card immediately under the last conversation, not
        pinned to the foot of the column. Only "LE CHAT SAIT" is pushed down,
        by its own `mt-auto`, which is why the scroll area is the growing
        child. The compact roster caps its height inside the panel, so there
        the create card stays outside the scroll: past a handful of rows it
        would otherwise scroll out of view, and it is the panel's only way to
        start a conversation.
      */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-[10px] pr-[6px]">
          {conversations.map((conversation) => (
            <ConversationRosterCard
              key={conversation.id}
              conversation={conversation}
              project={project}
              agentLabel={agentLabels.get(conversation.id) ?? "—"}
              active={conversation.id === activeId}
              ticketCount={ticketCounts.get(conversation.id) ?? 0}
              onSelect={() => onSelect(conversation.id)}
              onRestartPersistentSession={() =>
                onRestartPersistentSession(conversation.id)
              }
              onRename={
                onRename
                  ? (label) => onRename(conversation.id, label)
                  : undefined
              }
              renameDisabled={renameDisabled}
              onDelete={
                onDelete && conversations.length > 1
                  ? () => setPendingDelete(conversation)
                  : undefined
              }
              now={now}
            />
          ))}
          {compact ? null : createCard}
        </div>
      </ScrollArea>
      {compact ? createCard : null}

      {onDelete ? (
        <PermanentDeleteDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title={t("roster.deleteTitle")}
          description={t("roster.deleteDescription", {
            name: pendingDelete
              ? resolveLegacyConversationLabel(pendingDelete.type, pendingDelete.label)
              : "",
          })}
          confirmLabel={t("roster.delete")}
          deleting={deleting}
          onConfirm={confirmDelete}
        />
      ) : null}

      {variant === "page" ? <ChatKnowsCard /> : null}
    </div>
  );
}
