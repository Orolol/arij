/**
 * Tests that AgentActionsBar (merged EpicActions + StoryActions) shows the
 * correct buttons when an epic/story is in "done" status — specifically that
 * "Agent Review" is available on done items.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentActionsBar } from "@/components/shared/AgentActionsBar";

vi.mock("@/components/documents/MentionTextarea", () => ({
  MentionTextarea: ({
    projectId: _projectId,
    value,
    onValueChange,
    ...props
  }: {
    projectId?: string;
    value: string;
    onValueChange: (next: string) => void;
  }) => (
    <textarea
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      {...props}
    />
  ),
}));

const noop = vi.fn().mockResolvedValue(undefined);

describe("AgentActionsBar (epic target) — done status", () => {
  const baseProps = {
    projectId: "proj-1",
    target: {
      kind: "epic" as const,
      epic: { id: "e1", title: "Epic", status: "done" },
    },
    dispatching: false,
    isRunning: false,
    codexAvailable: false,
    onSendToDev: noop,
    onSendToReview: noop,
    onApprove: noop,
  };

  it("shows Agent Review button when epic is done", () => {
    render(<AgentActionsBar {...baseProps} />);
    expect(screen.getByText("Agent Review")).toBeInTheDocument();
  });

  it("does NOT show Send to Dev button when epic is done", () => {
    render(<AgentActionsBar {...baseProps} />);
    expect(screen.queryByText("Send to Dev")).not.toBeInTheDocument();
  });

  it("does NOT show Approve button when epic is done", () => {
    render(<AgentActionsBar {...baseProps} />);
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });
});

describe("AgentActionsBar (story target) — done status", () => {
  const baseProps = {
    projectId: "proj-1",
    target: {
      kind: "story" as const,
      story: { id: "s1", title: "Story", status: "done" },
    },
    dispatching: false,
    isRunning: false,
    codexAvailable: false,
    onSendToDev: noop,
    onSendToReview: noop,
    onApprove: noop,
  };

  it("shows Agent Review button when story is done", () => {
    render(<AgentActionsBar {...baseProps} />);
    expect(screen.getByText("Agent Review")).toBeInTheDocument();
  });

  it("does NOT show Send to Dev button when story is done", () => {
    render(<AgentActionsBar {...baseProps} />);
    expect(screen.queryByText("Send to Dev")).not.toBeInTheDocument();
  });

  it("does NOT show Approve button when story is done", () => {
    render(<AgentActionsBar {...baseProps} />);
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });
});
