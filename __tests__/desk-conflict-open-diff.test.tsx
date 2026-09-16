/**
 * A CONFLICT row's "Diff" opens the ticket ON its diff (audit 2026-09-10,
 * #133), on both desk hosts: the overlay context on `/`, and the host override
 * `/projects/:id` passes. Before, it opened the standard ticket and the user
 * had to click Diff a second time in the GIT band.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { NowDesk } from "@/components/desk/NowDesk";
import type { ControlDeskPayload } from "@/lib/control-desk/types";

const openTicket = vi.hoisted(() => vi.fn());
vi.mock("@/components/ticket/TicketOverlayProvider", () => ({
  useTicketOverlay: () => ({ openTicket }),
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
  today: { ticketsShipped: 0, failedSessions: 0, costUsd: 0, projects: 1, sessions: 0 },
  yourTurn: {
    awaitingReply: [],
    failed: [],
    conflicts: [
      {
        epicId: "clash",
        projectId: "p1",
        readableId: "ARJ-7",
        title: "Clashing branch",
        blocker: "merge_conflict",
        branchName: "feature/clash",
        at: "2026-09-16T08:00:00.000Z",
      },
    ],
  },
  readyToLand: [],
  heldBackCount: 0,
  upNext: [],
};

beforeEach(() => {
  openTicket.mockClear();
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: payload }),
  })) as unknown as typeof fetch;
});

describe("CONFLICT row — Diff", () => {
  it("opens the ticket on its diff through the overlay context", async () => {
    render(<NowDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "Diff" }));
    expect(openTicket).toHaveBeenCalledWith("clash", { projectId: "p1", view: "diff" });
  });

  it("asks a host override for the diff view too", async () => {
    const onOpenTicket = vi.fn();
    render(<NowDesk projectId="p1" onOpenTicket={onOpenTicket} />);
    fireEvent.click(await screen.findByRole("button", { name: "Diff" }));
    expect(onOpenTicket).toHaveBeenCalledWith("clash", { view: "diff" });
    expect(openTicket).not.toHaveBeenCalled();
  });
});
