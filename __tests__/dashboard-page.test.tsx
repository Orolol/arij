import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectGrid } from "@/components/dashboard/ProjectGrid";
import type { DashboardProject } from "@/lib/types/dashboard";
import type { InboxItem } from "@/hooks/useInbox";
import type { DashboardSummary } from "@/hooks/useDashboardSummary";

const state = vi.hoisted(() => ({
  projects: [] as DashboardProject[],
  inbox: [] as InboxItem[],
  summary: {
    runningSessions: [],
    nightRunsLastNight: { projects: 0, totalCostUsd: 0 },
    yesterday: { completed: 0, failed: 0 },
  } as DashboardSummary,
  setFilter: vi.fn(),
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects: state.projects,
    allProjects: state.projects,
    loading: false,
    error: null,
    filter: "all" as const,
    setFilter: state.setFilter,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useInbox", () => ({
  useInbox: () => ({
    items: state.inbox,
    unreadCount: 0,
    loading: false,
    markRead: vi.fn(),
    reply: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useDashboardSummary", () => ({
  useDashboardSummary: () => ({ ...state.summary, loading: false }),
}));

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: "proj-1",
    name: "Arij",
    description: null,
    status: "active",
    gitRepoPath: null,
    githubOwnerRepo: null,
    imported: 0,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-17T00:00:00Z",
    epicCount: 95,
    epicsDone: 3,
    epicsInProgress: 2,
    epicsReview: 1,
    epicsReleased: 92,
    activeAgents: 2,
    lastSessionAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function inboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    epicId: "ep-8",
    projectId: "proj-1",
    projectName: "Arij",
    readableId: "E-arij-008",
    title: "Archive handling",
    status: "in_progress",
    type: "feature",
    awaitingReply: true,
    unread: true,
    latestCommentAuthor: "agent",
    latestCommentExcerpt: "Should archived docs be included?",
    latestCommentCreatedAt: "2026-08-17T09:00:00Z",
    lastReadAt: null,
    ...overrides,
  };
}

describe("Dashboard", () => {
  beforeEach(() => {
    state.projects = [];
    state.inbox = [];
    state.summary = {
      runningSessions: [],
      nightRunsLastNight: { projects: 0, totalCostUsd: 0 },
      yesterday: { completed: 0, failed: 0 },
    };
  });

  it("renders honest zeros in the ambient band when nothing is happening", () => {
    render(<ProjectGrid />);

    const band = screen.getByTestId("dashboard-band");
    expect(band).toHaveTextContent("AGENTS WORKING");
    expect(band).toHaveTextContent("0 sessions");
    expect(band).toHaveTextContent("0 questions");
    expect(band).toHaveTextContent("0 projects · $0.00");
    expect(screen.getByText("All clear.")).toBeInTheDocument();
    expect(screen.getByText("None right now.")).toBeInTheDocument();
  });

  it("summarises live work across projects", () => {
    state.projects = [project(), project({ id: "proj-2", name: "Aster", activeAgents: 0 })];
    state.inbox = [inboxItem(), inboxItem({ epicId: "ep-9", awaitingReply: false })];
    state.summary = {
      runningSessions: [
        {
          sessionId: "sess-1",
          projectId: "proj-1",
          projectName: "Arij",
          epicId: "ep-93",
          epicReadableId: "E-arij-093",
          provider: "claude-code",
          agentType: "build",
          startedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
        },
      ],
      nightRunsLastNight: { projects: 2, totalCostUsd: 6.1 },
      yesterday: { completed: 7, failed: 1 },
    };

    render(<ProjectGrid />);

    const band = screen.getByTestId("dashboard-band");
    expect(band).toHaveTextContent("1 session");
    // Only the awaiting-reply inbox items count as open questions.
    expect(band).toHaveTextContent("1 question");
    expect(band).toHaveTextContent("2 projects · $6.10");
    expect(band).toHaveTextContent("DONE YESTERDAY");
    expect(band).toHaveTextContent("7");

    expect(screen.getByText("2 projects · 1 with active agents")).toBeInTheDocument();

    const running = screen.getByText(/Claude Code · build E-arij-093/);
    expect(running).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "Reply" }),
    ).toHaveAttribute("href", "/projects/proj-1?ticket=ep-8");
    expect(
      screen.getByText("« Should archived docs be included? »"),
    ).toBeInTheDocument();
  });

  it("renders a project card per project plus the new-project tile", () => {
    state.projects = [project(), project({ id: "proj-2", name: "Aster", activeAgents: 0 })];

    render(<ProjectGrid />);

    const card = screen.getByTestId("project-card-proj-1");
    expect(card).toHaveAttribute("href", "/projects/proj-1");
    expect(card).toHaveTextContent("2 agents");
    expect(card).toHaveTextContent("in progress");
    expect(card).toHaveTextContent("in review");
    expect(card).toHaveTextContent("released");
    expect(card).toHaveTextContent("last session 4m ago");

    expect(screen.getByTestId("project-card-proj-2")).toHaveTextContent("idle");
    expect(screen.getByTestId("project-card-new")).toHaveAttribute(
      "href",
      "/projects/new",
    );
  });
});
