/**
 * The activity chip used to label every provider except Gemini and Codex as
 * "Claude Code", so a Pi or OpenCode session showed the wrong agent on the
 * card. It now resolves through PROVIDER_LABELS.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => null } },
}));

import { EpicCard } from "@/components/kanban/EpicCard";

const baseEpic = {
  id: "epic-1",
  projectId: "proj-1",
  title: "Test Epic",
  description: null,
  priority: 1,
  status: "in_progress",
  position: 0,
  branchName: null,
  prNumber: null,
  prUrl: null,
  prStatus: null,
  confidence: null,
  evidence: null,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  usCount: 3,
  usDone: 1,
  type: "feature",
  linkedEpicId: null,
  images: null,
  readableId: null,
  releaseId: null,
};

function renderWithProvider(provider: string) {
  render(
    <EpicCard
      epic={baseEpic}
      view={{
        activity: {
          sessionId: "sess-1",
          actionType: "build",
          agentName: "agent 123abc",
          provider,
        },
      }}
    />,
  );
  return screen.getByTestId("epic-activity-epic-1");
}

describe("EpicCard provider label", () => {
  it("labels a Pi session as Pi", () => {
    expect(renderWithProvider("pi")).toHaveTextContent("Pi");
  });

  it("labels an Oh My Pi session as Oh My Pi", () => {
    expect(renderWithProvider("oh-my-pi")).toHaveTextContent("Oh My Pi");
  });

  it("no longer mislabels other providers as Claude Code", () => {
    const indicator = renderWithProvider("opencode");
    expect(indicator).toHaveTextContent("OpenCode");
    expect(indicator).not.toHaveTextContent("Claude Code");
  });

  it("keeps the established Claude Code label", () => {
    expect(renderWithProvider("claude-code")).toHaveTextContent("Claude Code");
  });

  it("keeps the established Gemini abbreviation", () => {
    expect(renderWithProvider("gemini-cli")).toHaveTextContent("Gemini");
  });

  it("falls back to the raw value for an unknown provider", () => {
    expect(renderWithProvider("some-future-cli")).toHaveTextContent(
      "some-future-cli",
    );
  });
});
