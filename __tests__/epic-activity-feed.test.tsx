/**
 * Tests for the unified epic activity feed: chronological interleaving of
 * comments and kanban transitions, actor styling, session links, and the
 * collapsing of consecutive system transitions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  EpicActivityFeed,
  buildActivityFeed,
  SYSTEM_GROUP_WINDOW_MS,
} from "@/components/kanban/epic-detail/EpicActivityFeed";
import type { TicketComment } from "@/hooks/useTicketComments";
import type { EpicActivityEntry } from "@/hooks/useEpicActivity";

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
  MentionTextarea: (props: { value: string; placeholder?: string }) => (
    <textarea
      data-testid="mention-textarea"
      value={props.value}
      placeholder={props.placeholder}
      readOnly
    />
  ),
}));

vi.mock("@/components/chat/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function comment(
  id: string,
  createdAt: string,
  overrides: Partial<TicketComment> = {}
): TicketComment {
  return {
    id,
    epicId: "e1",
    author: "user",
    content: `comment ${id}`,
    agentSessionId: null,
    createdAt,
    ...overrides,
  };
}

function transition(
  id: string,
  createdAt: string,
  overrides: Partial<EpicActivityEntry> = {}
): EpicActivityEntry {
  return {
    id,
    projectId: "p1",
    epicId: "e1",
    fromStatus: "todo",
    toStatus: "in_progress",
    actor: "user",
    reason: null,
    sessionId: null,
    createdAt,
    ...overrides,
  };
}

/** ISO timestamp `offsetMs` after a fixed base instant. */
function at(offsetMs: number): string {
  return new Date(
    new Date("2026-08-16T10:00:00.000Z").getTime() + offsetMs
  ).toISOString();
}

function renderFeed(
  entries: EpicActivityEntry[],
  comments: TicketComment[] = []
) {
  mockUseEpicActivity.mockReturnValue({
    entries,
    loading: false,
    refresh: vi.fn(),
  });
  return render(
    <EpicActivityFeed
      projectId="p1"
      epicId="e1"
      comments={comments}
      commentsLoading={false}
      onAddComment={vi.fn()}
    />
  );
}

const FEED_ITEM_SELECTOR =
  '[data-testid="activity-comment"], [data-testid="activity-transition"], [data-testid="activity-transition-group"]';

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* buildActivityFeed (pure)                                            */
/* ------------------------------------------------------------------ */

describe("buildActivityFeed", () => {
  it("interleaves comments and transitions oldest first", () => {
    const feed = buildActivityFeed(
      [comment("c1", at(1000)), comment("c2", at(3000))],
      // API order is newest first; the feed must still sort chronologically
      [transition("t2", at(2000)), transition("t1", at(0))]
    );

    expect(feed.map((i) => i.kind)).toEqual([
      "transition",
      "comment",
      "transition",
      "comment",
    ]);
    expect(
      feed.map((i) => (i.kind === "comment" ? i.comment.id : (i as { entry: { id: string } }).entry.id))
    ).toEqual(["t1", "c1", "t2", "c2"]);
  });

  it("collapses 2+ consecutive system transitions within the window", () => {
    const feed = buildActivityFeed(
      [],
      [
        transition("s1", at(0), { actor: "system" }),
        transition("s2", at(1000), { actor: "system" }),
        transition("s3", at(2000), { actor: "system" }),
      ]
    );

    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe("transition-group");
    expect(
      (feed[0] as { entries: EpicActivityEntry[] }).entries.map((e) => e.id)
    ).toEqual(["s1", "s2", "s3"]);
  });

  it("does not group a single system transition", () => {
    const feed = buildActivityFeed([], [transition("s1", at(0), { actor: "system" })]);
    expect(feed.map((i) => i.kind)).toEqual(["transition"]);
  });

  it("breaks a system run when the gap exceeds the window", () => {
    const feed = buildActivityFeed(
      [],
      [
        transition("s1", at(0), { actor: "system" }),
        transition("s2", at(1000), { actor: "system" }),
        transition("s3", at(1000 + SYSTEM_GROUP_WINDOW_MS + 1), {
          actor: "system",
        }),
      ]
    );

    expect(feed.map((i) => i.kind)).toEqual(["transition-group", "transition"]);
  });

  it("breaks a system run when a comment or non-system transition interleaves", () => {
    const feed = buildActivityFeed(
      [comment("c1", at(500))],
      [
        transition("s1", at(0), { actor: "system" }),
        transition("s2", at(1000), { actor: "system" }),
        transition("a1", at(2000), { actor: "agent" }),
        transition("s3", at(3000), { actor: "system" }),
      ]
    );

    // s1 / s2 are split by the comment, so no run reaches length 2
    expect(feed.map((i) => i.kind)).toEqual([
      "transition",
      "comment",
      "transition",
      "transition",
      "transition",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

describe("EpicActivityFeed", () => {
  it("renders comments and transitions interleaved in chronological order", () => {
    const { container } = renderFeed(
      [transition("t1", at(1000), { actor: "agent" })],
      [comment("c1", at(0)), comment("c2", at(2000))]
    );

    const kinds = Array.from(
      container.querySelectorAll(FEED_ITEM_SELECTOR)
    ).map((el) => el.getAttribute("data-testid"));
    expect(kinds).toEqual([
      "activity-comment",
      "activity-transition",
      "activity-comment",
    ]);
  });

  it("styles actors distinctly and shows status chips, reason and relative time", () => {
    renderFeed([
      transition("t1", at(0), { actor: "agent", reason: "Build started" }),
      transition("t2", at(SYSTEM_GROUP_WINDOW_MS * 5), {
        actor: "user",
        fromStatus: "in_progress",
        toStatus: "review",
      }),
    ]);

    const rows = screen.getAllByTestId("activity-transition");
    expect(rows.map((r) => r.getAttribute("data-actor"))).toEqual([
      "agent",
      "user",
    ]);
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Build started")).toBeInTheDocument();
    // Status chips use the kanban column labels
    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
    expect(screen.getByText("Review")).toBeInTheDocument();
    // Relative timestamps
    expect(rows[0].textContent).toMatch(/ago|just now/);
  });

  it("links to the session when sessionId is set", () => {
    renderFeed([
      transition("t1", at(0), { actor: "agent", sessionId: "sess-42" }),
      transition("t2", at(SYSTEM_GROUP_WINDOW_MS * 5), { actor: "user" }),
    ]);

    const links = screen.getAllByTestId("activity-session-link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute(
      "href",
      "/projects/p1/sessions/sess-42"
    );
  });

  it("collapses consecutive system transitions and expands them on click", () => {
    renderFeed([
      transition("s1", at(0), { actor: "system" }),
      transition("s2", at(1000), { actor: "system" }),
      transition("s3", at(2000), { actor: "system" }),
    ]);

    expect(screen.queryAllByTestId("activity-transition")).toHaveLength(0);
    const group = screen.getByTestId("activity-transition-group");
    expect(group.textContent).toContain("3 automatic transitions");

    fireEvent.click(group);
    expect(screen.getAllByTestId("activity-transition")).toHaveLength(3);

    fireEvent.click(group);
    expect(screen.queryAllByTestId("activity-transition")).toHaveLength(0);
  });

  it("shows the total activity count and an empty state", () => {
    renderFeed([transition("t1", at(0))], [comment("c1", at(1000))]);
    expect(screen.getByText("Activity (2)")).toBeInTheDocument();
  });

  it("renders an empty state when there is no activity", () => {
    renderFeed([], []);
    expect(
      screen.getByText("No activity yet. Start the conversation.")
    ).toBeInTheDocument();
  });
});
