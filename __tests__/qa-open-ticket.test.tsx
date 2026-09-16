/**
 * How /qa opens a ticket (audit 2026-09-10, lot 05).
 *
 * - #133 a finding's "Diff" opens the ticket ON its diff, as the desk's
 *   CONFLICT row does — not on the standard ticket.
 * - #134 unfiltered, the screen has no project of its own: a run card (or a
 *   queued run) must hand the overlay the run's project, or the overlay opens
 *   with nothing to read.
 * - #122 under TicketOverlayProvider the screen raises into the provider's
 *   stack instead of drawing a second one in the same corner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { QaScreen } from "@/components/qa/QaScreen";
import { qaPayload } from "./support/toast-fixtures";
import type { QaPayload } from "@/lib/qa/types";

const overlay = vi.hoisted(() => ({
  openTicket: vi.fn(),
  raiseToast: null as null | ReturnType<typeof vi.fn>,
}));
vi.mock("@/components/ticket/TicketOverlayProvider", () => ({
  useTicketOverlay: () => ({
    openTicket: overlay.openTicket,
    closeTicket: vi.fn(),
    raiseToast: overlay.raiseToast,
  }),
}));

function payload(): QaPayload {
  return {
    ...qaPayload(),
    projects: [
      ...qaPayload().projects,
      { id: "p2", name: "Other", shortName: "OTH", colorIndex: 1, activeAgents: 0, autoModeEnabled: false },
    ],
    runs: [
      {
        sessionId: "s-run",
        projectId: "p2",
        epicId: "e-run",
        readableId: "OTH-3",
        title: "Review of the export",
        agentName: null,
        startedAt: new Date().toISOString(),
        lastLine: null,
        findingsFiled: null,
        blockingFiled: null,
      },
    ],
    queued: [
      { sessionId: "s-queued", projectId: "p2", epicId: "e-queued", readableId: "OTH-4", title: "Queued review" },
    ],
  };
}

function installFetch(buildStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/qa/findings") {
        return new Response(JSON.stringify({ data: payload() }), { status: 200 });
      }
      if (url.includes("/build") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "Le worktree est verrouillé" }), {
          status: buildStatus,
        });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  overlay.openTicket.mockReset();
  overlay.raiseToast = null;
});

describe("/qa opens the ticket it names", () => {
  it("opens a finding's ticket on its diff", async () => {
    installFetch();
    render(<QaScreen />);
    fireEvent.click(await screen.findByTestId("qa-finding-diff"));
    expect(overlay.openTicket).toHaveBeenCalledWith("e1", { projectId: "p1", view: "diff" });
  });

  it("hands the overlay a run's own project on the unfiltered screen", async () => {
    installFetch();
    render(<QaScreen />);
    const card = await screen.findByTestId("qa-run-card");
    fireEvent.click(within(card).getByRole("button", { name: /Review of the export/ }));
    expect(overlay.openTicket).toHaveBeenCalledWith("e-run", { projectId: "p2" });
  });

  it("hands the overlay a queued run's own project too", async () => {
    installFetch();
    render(<QaScreen />);
    const tile = await screen.findByTestId("qa-queued-tile");
    fireEvent.click(within(tile).getByRole("button", { name: /Queued review/ }));
    expect(overlay.openTicket).toHaveBeenCalledWith("e-queued", { projectId: "p2" });
  });
});

describe("/qa under the overlay provider", () => {
  it("raises into the provider's stack and draws none of its own", async () => {
    overlay.raiseToast = vi.fn();
    installFetch(500);
    render(<QaScreen />);
    fireEvent.click(await screen.findByTestId("qa-finding-fix"));

    await waitFor(() =>
      expect(overlay.raiseToast).toHaveBeenCalledWith("error", "Le worktree est verrouillé", undefined),
    );
    expect(screen.queryByTestId("qa-toast")).not.toBeInTheDocument();
  });
});
