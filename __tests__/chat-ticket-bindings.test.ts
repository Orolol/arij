import { describe, expect, it } from "vitest";
import { flattenDeskTickets, uniqueTicketsByTitle, type DeskTicket } from "@/components/chat-page/ticket-bindings";
import type { ControlDeskPayload, DeskQueueTicket } from "@/lib/control-desk/types";

function ticket(epicId: string, projectId: string): DeskQueueTicket {
  return { epicId, projectId, title: "Shared title", readableId: epicId, status: "todo",
    rank: 1, blockedBy: [], awaitingReply: false, specOnly: false, storyCount: 1 };
}
const base: ControlDeskPayload = {
  generatedAt: "2026-09-10", projects: [], working: [], queued: [],
  today: { ticketsShipped: 0, failedSessions: 0, costUsd: 0, projects: 0, sessions: 0 },
  yourTurn: { awaitingReply: [], failed: [], conflicts: [] }, readyToLand: [], upNext: [], heldBackCount: 0,
};

describe("chat ticket identity", () => {
  it("never binds a draft to another project's same-title ticket", () => {
    const rows = flattenDeskTickets({ ...base,
      upNext: [
        { projectId: "other", tickets: [ticket("foreign", "other")] },
        { projectId: "here", tickets: [ticket("local", "here")] },
      ],
      readyToLand: [{ epicId: "foreign-land", projectId: "other", title: "Other", readableId: null,
        prNumber: null, usDone: 1, usCount: 1, openFindings: 0, agentBusy: false }],
    }, "here");
    expect(rows.map((row) => row.epicId)).toEqual(["local"]);
    expect(uniqueTicketsByTitle(rows).get("shared title")?.epicId).toBe("local");
  });

  it("does not guess when two different tickets share a title", () => {
    const rows: DeskTicket[] = [ticket("one", "here"), ticket("two", "here")];
    expect(uniqueTicketsByTitle(rows).has("shared title")).toBe(false);
  });

  it("the same ticket appearing in multiple desk strata stays unambiguous", () => {
    const row = ticket("one", "here");
    expect(uniqueTicketsByTitle([row, { ...row, title: " SHARED TITLE " }]).get("shared title")?.epicId).toBe("one");
  });
});
