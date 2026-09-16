/**
 * The PIPELINE card (audit 2026-09-10, lot 05).
 *
 * - #72 a registry run is told in words: stage, attempt n/max, fix cycle
 *   n/max, and the runner's reason once the run failed, paused or stopped.
 * - #119 a ticket in a movable column shows its queue rank and the four
 *   moves, disabled at the edges and while a move is in flight, with the
 *   refusal as a sentence under the control.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { PipelineCard } from "@/components/ticket/PipelineCard";
import { pipelineSteps } from "@/components/ticket/derive";

function renderCard(overrides: Partial<ComponentProps<typeof PipelineCard>> = {}) {
  const props: ComponentProps<typeof PipelineCard> = {
    steps: pipelineSteps("todo", false),
    status: "todo",
    priority: 1,
    hasRunningSession: false,
    statusError: null,
    onStatusChange: vi.fn(),
    onPriorityChange: vi.fn(),
    run: null,
    queue: null,
    queueMoving: false,
    queueError: null,
    onQueueMove: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PipelineCard {...props} />) };
}

describe("PipelineCard run line", () => {
  it("says nothing about a run when the ticket has none", () => {
    renderCard();
    expect(screen.queryByTestId("ticket-pipeline-run")).toBeNull();
  });

  it("names the stage, the attempt and the fix cycle of an active run", () => {
    renderCard({
      run: {
        state: "running",
        stage: "review",
        attempt: { count: 2, max: 3 },
        fixCycles: { count: 1, max: 2 },
        reason: null,
        story: null,
        endedAt: null,
      },
    });
    expect(screen.getByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Running · Review · attempt 2/3 · fix cycle 1/2",
    );
    expect(screen.queryByTestId("ticket-pipeline-run-reason")).toBeNull();
  });

  it("prints bare counters when the caps are unknown", () => {
    renderCard({
      run: {
        state: "running",
        stage: "fix",
        attempt: { count: 1, max: null },
        fixCycles: { count: 1, max: null },
        reason: null,
        story: null,
        endedAt: null,
      },
    });
    expect(screen.getByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Running · Fix · attempt 1 · fix cycle 1",
    );
  });

  it("gives a failed run its outcome word and the runner's reason", () => {
    renderCard({
      run: {
        state: "failed",
        stage: "review",
        attempt: null,
        fixCycles: { count: 2, max: 2 },
        reason: "blocking findings remain after 2 fix cycles",
        story: null,
        endedAt: null,
      },
    });
    expect(screen.getByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Last run failed · fix cycle 2/2",
    );
    expect(screen.getByTestId("ticket-pipeline-run-reason")).toHaveTextContent(
      "blocking findings remain after 2 fix cycles",
    );
  });

  it("says a paused run is waiting on a question", () => {
    renderCard({
      run: {
        state: "paused_question",
        stage: "build",
        attempt: null,
        fixCycles: null,
        reason: "agent asked a question (build)",
        story: null,
        endedAt: null,
      },
    });
    expect(screen.getByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Paused on a question",
    );
    expect(screen.getByTestId("ticket-pipeline-run-reason")).toHaveTextContent(
      "agent asked a question (build)",
    );
  });
});

describe("PipelineCard run line — story runs and old outcomes", () => {
  it("names the story a story run is building", () => {
    renderCard({
      run: {
        state: "running",
        stage: "build",
        attempt: { count: 1, max: 3 },
        fixCycles: null,
        reason: null,
        story: "Export CSV",
        endedAt: null,
      },
    });
    expect(screen.getByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Running · Build · story Export CSV · attempt 1/3",
    );
  });

  it("dates a finished run so an old outcome does not read as the present", () => {
    renderCard({
      run: {
        state: "failed",
        stage: "review",
        attempt: null,
        fixCycles: null,
        reason: "session cap reached",
        story: null,
        endedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    });
    expect(screen.getByTestId("ticket-pipeline-run")).toHaveTextContent(
      "Last run failed · 5m ago",
    );
  });
});

describe("PipelineCard queue control", () => {
  const middle = { status: "todo", rank: 3, total: 7, movable: true };

  it("shows the rank and four enabled moves in the middle of the column", () => {
    renderCard({ queue: middle });
    expect(screen.getByTestId("ticket-queue")).toHaveTextContent("#3 of 7 in To Do");
    for (const name of [
      "Move to the top of the column",
      "Move up",
      "Move down",
      "Move to the bottom of the column",
    ]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("sends the clicked move", () => {
    const onQueueMove = vi.fn();
    renderCard({ queue: middle, onQueueMove });
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to the bottom of the column" }));
    expect(onQueueMove.mock.calls).toEqual([["up"], ["bottom"]]);
  });

  it("disables up and top on the first ticket", () => {
    renderCard({ queue: { ...middle, rank: 1 } });
    expect(screen.getByRole("button", { name: "Move to the top of the column" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move down" })).toBeEnabled();
  });

  it("disables down and bottom on the last ticket", () => {
    renderCard({ queue: { ...middle, rank: 7 } });
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move to the bottom of the column" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move up" })).toBeEnabled();
  });

  it("disables every move and says so while one is in flight", () => {
    renderCard({ queue: middle, queueMoving: true });
    expect(screen.getByTestId("ticket-queue")).toHaveTextContent("Moving…");
    for (const button of screen.getAllByRole("button", { name: /Move/ })) {
      expect(button).toBeDisabled();
    }
  });

  // The rank is the column's, not UP NEXT's (which merges In Progress ahead
  // of To Do and skips blocked tickets): the words must not promise the
  // global queue.
  it("names the column the rank is counted in, never 'queue'", () => {
    renderCard({ queue: { status: "in_progress", rank: 2, total: 4, movable: true } });
    const control = screen.getByTestId("ticket-queue");
    expect(control).toHaveTextContent("#2 of 4 in In Progress");
    expect(control.textContent ?? "").not.toMatch(/queue/i);
    for (const button of screen.getAllByRole("button", { name: /Move/ })) {
      expect(button.getAttribute("title") ?? "").not.toMatch(/queue/i);
    }
  });

  it("shows no control for a column that is not a queue", () => {
    renderCard({ queue: { status: "done", rank: 1, total: 4, movable: false } });
    expect(screen.queryByTestId("ticket-queue")).toBeNull();
  });

  it("puts the refusal under the control", () => {
    renderCard({ queue: middle, queueError: "Cannot reorder done tickets" });
    expect(screen.getByTestId("ticket-queue-error")).toHaveTextContent(
      "Cannot reorder done tickets",
    );
  });
});
