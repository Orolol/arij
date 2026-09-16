"use client";

/**
 * TicketOverlayProvider — the one way a screen opens a ticket.
 *
 * THE CONTRACT — unchanged since the foundation gate, and depended on by the
 * desk, the board and every future ticket reference:
 *
 *   const { openTicket, closeTicket, ticketId } = useTicketOverlay();
 *   openTicket(epicId, { projectId })   // opens
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
 */

import * as React from "react";
import { useCallback, useContext, useMemo, useState } from "react";

import { TicketOverlay } from "@/components/ticket/TicketOverlay";

export interface OpenTicketOptions {
  /** Which project the ticket belongs to. Required by the real overlay's fetch. */
  projectId?: string | null;
}

export interface TicketOverlayContextValue {
  /** The open ticket's epic id, or `null` when the overlay is closed. */
  ticketId: string | null;
  /** The open ticket's project, when the caller knew it. */
  projectId: string | null;
  open: boolean;
  openTicket: (epicId: string, options?: OpenTicketOptions) => void;
  closeTicket: () => void;
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
};

export interface TicketOverlayProviderProps {
  children: React.ReactNode;
}

export function TicketOverlayProvider({
  children,
}: TicketOverlayProviderProps) {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const openTicket = useCallback(
    (epicId: string, options?: OpenTicketOptions) => {
      setTicketId(epicId);
      setProjectId(options?.projectId ?? null);
    },
    [],
  );

  const closeTicket = useCallback(() => {
    setTicketId(null);
    setProjectId(null);
  }, []);

  const value = useMemo<TicketOverlayContextValue>(
    () => ({
      ticketId,
      projectId,
      open: ticketId !== null,
      openTicket,
      closeTicket,
    }),
    [ticketId, projectId, openTicket, closeTicket],
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
          onClose={closeTicket}
        />
      ) : null}
    </TicketOverlayContext.Provider>
  );
}
