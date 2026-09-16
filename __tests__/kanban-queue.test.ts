import { describe, it, expect } from "vitest";
import {
  computeBlockedBy,
  computeQueueRanks,
} from "@/lib/kanban/queue";
import type { TicketDependencyEdge } from "@/lib/types/kanban";

/**
 * A board row as the tests build it. The helpers under test read `id`,
 * `status` and `position` only; the rest is here so a fixture can carry the
 * fields the old board-level row type had without dragging that type back in.
 */
interface EpicRow {
  id: string;
  [key: string]: unknown;
}

function makeEpic(overrides: Partial<EpicRow> & { id: string }): EpicRow {
  return {
    projectId: "proj-1",
    title: overrides.id,
    description: null,
    priority: 1,
    status: "todo",
    position: 0,
    branchName: null,
    prNumber: null,
    prUrl: null,
    prStatus: null,
    confidence: null,
    evidence: null,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    type: "feature",
    linkedEpicId: null,
    images: null,
    readableId: null,
    releaseId: null,
    usCount: 1,
    usDone: 0,
    latestCommentId: null,
    latestCommentAuthor: null,
    latestCommentCreatedAt: null,
    ...overrides,
    // Unless a test says otherwise, every story carries a rubric — the
    // interesting cases override one or the other.
    usWithCriteriaCount:
      overrides.usWithCriteriaCount ?? overrides.usCount ?? 1,
  };
}

function edge(ticketId: string, dependsOnTicketId: string): TicketDependencyEdge {
  return { ticketId, dependsOnTicketId };
}

describe("computeBlockedBy", () => {
  it("lists only the undelivered targets of each epic", () => {
    const statusById = new Map([
      ["a", "in_progress"],
      ["b", "done"],
      ["c", "released"],
      ["d", "todo"],
    ]);
    const blocked = computeBlockedBy(
      [edge("x", "a"), edge("x", "b"), edge("x", "c"), edge("y", "d")],
      statusById
    );

    // b (done) and c (released) are satisfied targets and never block.
    expect(blocked.get("x")).toEqual(["a"]);
    expect(blocked.get("y")).toEqual(["d"]);
    expect(blocked.has("z")).toBe(false);
  });

  it("omits epics whose targets are all delivered", () => {
    const blocked = computeBlockedBy([edge("x", "b")], new Map([["b", "done"]]));
    expect(blocked.size).toBe(0);
  });

  it("treats unknown targets as not delivered", () => {
    const blocked = computeBlockedBy([edge("x", "ghost")], new Map());
    expect(blocked.get("x")).toEqual(["ghost"]);
  });

  it("returns an empty map for a dependency-free board", () => {
    const blocked = computeBlockedBy([], new Map([["a", "todo"]]));
    expect(blocked.size).toBe(0);
  });

  it("never blocks a dependent that is itself delivered", () => {
    // Full Auto ignores ticket_dependencies, so an epic can legitimately be
    // merged ahead of a prerequisite that is still open. Once delivered it
    // must stop advertising the block.
    const statusById = new Map([
      ["shipped", "done"],
      ["released", "released"],
      ["open", "todo"],
      ["late", "backlog"],
    ]);
    const blocked = computeBlockedBy(
      [edge("shipped", "late"), edge("released", "late"), edge("open", "late")],
      statusById
    );

    expect(blocked.has("shipped")).toBe(false);
    expect(blocked.has("released")).toBe(false);
    expect(blocked.get("open")).toEqual(["late"]);
  });
});

describe("computeQueueRanks", () => {
  it("numbers the surviving epics in list order, skipping excluded ones", () => {
    const a = makeEpic({ id: "a" });
    const b = makeEpic({ id: "b" });
    const c = makeEpic({ id: "c" });

    const ranks = computeQueueRanks([a, b, c], (epic) => epic.id === "b");

    expect(ranks.get("a")).toBe(1);
    expect(ranks.has("b")).toBe(false);
    // The skip leaves no gap: c is third in the column but second in the queue.
    expect(ranks.get("c")).toBe(2);
  });

  it("starts at 1 even when the head of the column is excluded", () => {
    const a = makeEpic({ id: "a" });
    const b = makeEpic({ id: "b" });

    const ranks = computeQueueRanks([a, b], (epic) => epic.id === "a");

    expect(ranks.get("b")).toBe(1);
    expect(ranks.has("a")).toBe(false);
  });

  it("returns an empty map for an empty column", () => {
    expect(computeQueueRanks([], () => false).size).toBe(0);
  });
});
