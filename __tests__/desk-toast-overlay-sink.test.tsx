/**
 * One toast stack per route on `/` (audit 2026-09-10, lot 05, #122).
 *
 * TicketOverlayProvider draws a stack for the overlay's merge, deletion and
 * conflict feedback. The desk drew its own in the same fixed corner, so a
 * merge confirmed by the provider and a failure raised by the desk covered
 * each other. Under a provider the desk now raises into the provider's stack.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { NowDesk } from "@/components/desk/NowDesk";
import type { ControlDeskPayload } from "@/lib/control-desk/types";

const overlay = vi.hoisted(() => ({
  openTicket: vi.fn(),
  raiseToast: null as null | ReturnType<typeof vi.fn>,
}));
vi.mock("@/components/ticket/TicketOverlayProvider", () => ({
  useTicketOverlay: () => ({ openTicket: overlay.openTicket, raiseToast: overlay.raiseToast }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [], loading: false, refresh: vi.fn() }),
}));

const payload: ControlDeskPayload = {
  generatedAt: "2026-09-16T09:00:00.000Z",
  projects: [
    { id: "p1", name: "Arij", shortName: "ARIJ", colorIndex: 0, activeAgents: 0, autoModeEnabled: false },
  ],
  working: [],
  queued: [],
  today: { ticketsShipped: 0, failedSessions: 1, costUsd: 0, projects: 1, sessions: 1 },
  yourTurn: {
    awaitingReply: [],
    failed: [
      {
        epicId: "e1",
        projectId: "p1",
        readableId: "ARJ-9",
        title: "Worker pool",
        sessionId: "s9",
        error: "exit 1",
        agentType: "build",
        agentName: "Opus Builder",
        provider: "claude-code",
        namedAgentId: "a1",
        userStoryId: null,
        producedOutput: true,
        failedAt: "2026-09-16T08:39:00.000Z",
      },
    ],
    conflicts: [],
  },
  readyToLand: [],
  heldBackCount: 0,
  upNext: [],
};

beforeEach(() => {
  overlay.raiseToast = null;
  global.fetch = vi.fn(async (url: string) => {
    if (url === "/api/control-desk") {
      return { ok: true, status: 200, json: async () => ({ data: payload }) };
    }
    return { ok: false, status: 500, json: async () => ({ error: "Retry refused" }) };
  }) as unknown as typeof fetch;
});

describe("NowDesk toasts under the overlay provider", () => {
  it("raises into the provider's stack and draws none of its own", async () => {
    overlay.raiseToast = vi.fn();
    render(<NowDesk />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(overlay.raiseToast).toHaveBeenCalledWith("error", "Retry refused", undefined),
    );
    expect(screen.queryByTestId("desk-toast")).not.toBeInTheDocument();
  });

  it("keeps its own stack outside a provider", async () => {
    render(<NowDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("desk-toast")).toHaveTextContent("Retry refused");
  });

  it("leaves the host page's sink in charge on /projects/:id", async () => {
    overlay.raiseToast = vi.fn();
    const onToast = vi.fn();
    render(<NowDesk projectId="p1" onToast={onToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(overlay.raiseToast).not.toHaveBeenCalled();
  });
});
