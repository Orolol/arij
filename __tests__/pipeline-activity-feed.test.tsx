/**
 * Epic activity feed — autonomous pipeline trace entries.
 *
 * Pipeline entries are `system` transitions with fromStatus === toStatus, so
 * without special handling they would be swallowed by the "N automatic
 * transitions" collapsing. These tests pin that they stay visible, render
 * their reason text, and are toned by outcome.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  EpicActivityFeed,
  buildActivityFeed,
} from "@/components/kanban/epic-detail/EpicActivityFeed";
import type { EpicActivityEntry } from "@/hooks/useEpicActivity";
import { PIPELINE_REASONS } from "@/lib/pipeline/constants";

const mockUseEpicActivity = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useEpicActivity", () => ({
  useEpicActivity: (...args: unknown[]) => mockUseEpicActivity(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/documents/MentionTextarea", () => ({
  MentionTextarea: () => <textarea data-testid="mention-textarea" readOnly />,
}));

vi.mock("@/components/chat/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

let seq = 0;
function pipelineEntry(
  reason: string,
  overrides: Partial<EpicActivityEntry> = {}
): EpicActivityEntry {
  seq += 1;
  return {
    id: `p${seq}`,
    projectId: "proj-1",
    epicId: "epic-1",
    fromStatus: "in_progress",
    toStatus: "in_progress",
    actor: "system",
    reason,
    sessionId: `sess-${seq}`,
    createdAt: new Date(2026, 0, 1, 10, seq).toISOString(),
    ...overrides,
  };
}

function plainSystemEntry(overrides: Partial<EpicActivityEntry> = {}): EpicActivityEntry {
  seq += 1;
  return {
    id: `s${seq}`,
    projectId: "proj-1",
    epicId: "epic-1",
    fromStatus: "in_progress",
    toStatus: "review",
    actor: "system",
    reason: "Agent finished the build",
    sessionId: null,
    createdAt: new Date(2026, 0, 1, 10, seq).toISOString(),
    ...overrides,
  };
}

function renderFeed(entries: EpicActivityEntry[]) {
  mockUseEpicActivity.mockReturnValue({
    entries,
    loading: false,
    refresh: vi.fn(),
  });
  return render(
    <EpicActivityFeed
      projectId="proj-1"
      epicId="epic-1"
      comments={[]}
      commentsLoading={false}
      onAddComment={vi.fn(async () => undefined)}
    />
  );
}

beforeEach(() => {
  seq = 0;
  mockUseEpicActivity.mockReset();
});

describe("buildActivityFeed — pipeline entries", () => {
  it("splits pipeline entries out of the system-transition grouping", () => {
    const entries = [
      pipelineEntry(PIPELINE_REASONS.started),
      pipelineEntry(PIPELINE_REASONS.reviewStarted),
      pipelineEntry(PIPELINE_REASONS.finished),
    ];

    const feed = buildActivityFeed([], entries);

    expect(feed.map((i) => i.kind)).toEqual(["pipeline", "pipeline", "pipeline"]);
  });

  it("still groups ordinary consecutive system transitions", () => {
    const entries = [plainSystemEntry(), plainSystemEntry()];
    const feed = buildActivityFeed([], entries);
    expect(feed.map((i) => i.kind)).toEqual(["transition-group"]);
  });

  it("breaks a grouping run when a pipeline entry lands between system ones", () => {
    const entries = [
      plainSystemEntry(),
      pipelineEntry(PIPELINE_REASONS.reviewStarted),
      plainSystemEntry(),
    ];
    const feed = buildActivityFeed([], entries);
    expect(feed.map((i) => i.kind)).toEqual([
      "transition",
      "pipeline",
      "transition",
    ]);
  });
});

describe("EpicActivityFeed — pipeline row rendering", () => {
  it("renders each pipeline trace line with its reason text", () => {
    renderFeed([
      pipelineEntry(PIPELINE_REASONS.started),
      pipelineEntry(PIPELINE_REASONS.fixStarted(1, 2)),
    ]);

    const rows = screen.getAllByTestId("activity-pipeline");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(
      "Pipeline started (build → review → auto-fix)"
    );
    expect(rows[1]).toHaveTextContent("Pipeline stage: fix started (cycle 1/2)");
    // No "moved in_progress → in_progress" noise on a pipeline row.
    expect(screen.queryByTestId("activity-transition")).not.toBeInTheDocument();
  });

  it("tones rows by outcome (progress / success / paused / failure)", () => {
    renderFeed([
      pipelineEntry(PIPELINE_REASONS.reviewStarted),
      pipelineEntry(PIPELINE_REASONS.finished),
      pipelineEntry(PIPELINE_REASONS.pausedQuestion("build")),
      pipelineEntry(PIPELINE_REASONS.failedStage("review", 2)),
      pipelineEntry(PIPELINE_REASONS.cancelled),
    ]);

    const tones = screen
      .getAllByTestId("activity-pipeline")
      .map((el) => el.getAttribute("data-tone"));
    expect(tones).toEqual([
      "progress",
      "success",
      "paused",
      "failure",
      "paused",
    ]);
  });

  it("links a pipeline row to the stage session that produced it", () => {
    renderFeed([
      pipelineEntry(PIPELINE_REASONS.reviewStarted, { sessionId: "sess-42" }),
    ]);

    expect(screen.getByTestId("activity-session-link")).toHaveAttribute(
      "href",
      "/projects/proj-1/sessions/sess-42"
    );
  });
});
