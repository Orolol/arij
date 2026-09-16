"use client";

/**
 * TicketOverlayProvider — the one way a screen opens a ticket.
 *
 * THE CONTRACT — unchanged since the foundation gate, and depended on by the
 * desk, the board and every future ticket reference:
 *
 *   const { openTicket, closeTicket, ticketId } = useTicketOverlay();
 *   openTicket(epicId, { projectId })   // opens
 *   openTicket(epicId, { projectId, view: "diff" })  // opens on the diff
 *   closeTicket()                       // closes; Escape does too
 *
 * Screens NEVER import the overlay tree. They call `openTicket()` and the
 * provider decides what to render, which is what let frame 6a land as a swap
 * of the panel body alone.
 *
 * WHAT CHANGED WHEN 6a LANDED: the panel is now the real `TicketOverlay`,
 * which paints its own scrim and modal (it needs the full 1200px /
 * max-height / overflow geometry and the Escape *precedence* rules — a delete
 * or dispatch dialog on top must swallow Escape, and only a component that
 * knows those dialogs are open can decide that). The transitional
 * `renderPanel` seam that carried 6a in was never passed by any caller and is
 * gone.
 *
 * FEEDBACK. This provider is the only overlay host on `/`, `/tickets`, `/qa`
 * and `/chat`, so it owns what `/projects/:id` does for its own overlay: a
 * toast for a merge, a deletion, and a 409 AGENT_ALREADY_RUNNING (with a link
 * to the session in the way). The stack lives here rather than in the overlay
 * because a merge and a deletion close the overlay — the confirmation has to
 * outlive it.
 *
 * ONE STACK PER ROUTE. The screens under this provider (the desk, /qa, /chat)
 * raise toasts of their own, and a second stack would sit in the same fixed
 * corner: a merge confirmed here and a poll failure raised there would cover
 * each other. So the provider hands its `raiseToast` down through the context
 * and those screens use it as their host sink (`useToastStack(onToast)`),
 * rendering no stack of their own. Outside a provider it is null and a screen
 * keeps its own stack.
 */

import * as React from "react";
import { useCallback, useContext, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ToastStack, type RaiseToast } from "@/components/toast/ToastStack";
import { useToastStack } from "@/components/toast/useToastStack";
import {
  TicketOverlay,
  type TicketOverlayView,
} from "@/components/ticket/TicketOverlay";

export interface OpenTicketOptions {
  /** Which project the ticket belongs to. Required by the real overlay's fetch. */
  projectId?: string | null;
  /** Open straight onto the full diff instead of the ticket. */
  view?: TicketOverlayView;
}

export interface TicketOverlayContextValue {
  /** The open ticket's epic id, or `null` when the overlay is closed. */
  ticketId: string | null;
  /** The open ticket's project, when the caller knew it. */
  projectId: string | null;
  open: boolean;
  openTicket: (epicId: string, options?: OpenTicketOptions) => void;
  closeTicket: () => void;
  /**
   * The provider's toast stack, for the screen under it to raise into instead
   * of rendering a second stack in the same corner. Null outside a provider.
   */
  raiseToast: RaiseToast | null;
}

const TicketOverlayContext = React.createContext<TicketOverlayContextValue | null>(
  null,
);

/**
 * Read the overlay controls.
 *
 * Returns a no-op implementation outside a provider rather than throwing: a
 * desk band rendered in isolation (a unit test, the primitive preview) must not
 * need the whole app shell to mount.
 */
export function useTicketOverlay(): TicketOverlayContextValue {
  const value = useContext(TicketOverlayContext);
  return value ?? NOOP_OVERLAY;
}

const NOOP_OVERLAY: TicketOverlayContextValue = {
  ticketId: null,
  projectId: null,
  open: false,
  openTicket: () => {},
  closeTicket: () => {},
  raiseToast: null,
};

export interface TicketOverlayProviderProps {
  children: React.ReactNode;
}

export function TicketOverlayProvider({
  children,
}: TicketOverlayProviderProps) {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<TicketOverlayView>("ticket");
  const t = useTranslations("Ticket");
  const { toasts, raise, dismiss } = useToastStack();

  const openTicket = useCallback(
    (epicId: string, options?: OpenTicketOptions) => {
      setTicketId(epicId);
      setProjectId(options?.projectId ?? null);
      setView(options?.view ?? "ticket");
    },
    [],
  );

  const closeTicket = useCallback(() => {
    setTicketId(null);
    setProjectId(null);
    setView("ticket");
  }, []);

  const value = useMemo<TicketOverlayContextValue>(
    () => ({
      ticketId,
      projectId,
      open: ticketId !== null,
      openTicket,
      closeTicket,
      raiseToast: raise,
    }),
    [ticketId, projectId, openTicket, closeTicket, raise],
  );

  return (
    <TicketOverlayContext.Provider value={value}>
      {children}
      {ticketId ? (
        // The real 6a overlay: it paints its own scrim, owns the modal
        // geometry and owns Escape precedence over its dialogs.
        <TicketOverlay
          projectId={projectId ?? ""}
          epicId={ticketId}
          open
          initialView={view}
          onClose={closeTicket}
          // A dependency is a ticket of the same project.
          onOpenTicket={(epicId) => openTicket(epicId, { projectId })}
          onAgentConflict={({ message, sessionUrl }) =>
            raise(
              "error",
              message,
              sessionUrl
                ? { href: sessionUrl, label: t("feedback.openActiveSession") }
                : undefined,
            )
          }
          onMerged={() => raise("success", t("feedback.merged"))}
          onDeleted={() => raise("success", t("feedback.deleted"))}
        />
      ) : null}
      <ToastStack items={toasts} onDismiss={dismiss} testId="ticket-overlay-toast" />
    </TicketOverlayContext.Provider>
  );
}
