import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { EpicDetail } from "@/components/kanban/EpicDetail";

const mockUseEpicDetail = vi.hoisted(() => vi.fn());
const mockUseTicketComments = vi.hoisted(() => vi.fn());
const mockUseAgentDispatch = vi.hoisted(() => vi.fn());
const mockUseEpicPr = vi.hoisted(() => vi.fn());
const mockUseGitHubConfig = vi.hoisted(() => vi.fn());
const mockUseGitStatus = vi.hoisted(() => vi.fn());
const mockUseProvidersAvailable = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useEpicDetail", () => ({
  useEpicDetail: (...args: unknown[]) => mockUseEpicDetail(...args),
}));

vi.mock("@/hooks/useTicketComments", () => ({
  useTicketComments: (...args: unknown[]) => mockUseTicketComments(...args),
}));

vi.mock("@/hooks/useAgentDispatch", () => ({
  useAgentDispatch: (...args: unknown[]) => mockUseAgentDispatch(...args),
}));

vi.mock("@/hooks/useEpicPr", () => ({
  useEpicPr: (...args: unknown[]) => mockUseEpicPr(...args),
}));

vi.mock("@/hooks/useGitHubConfig", () => ({
  useGitHubConfig: (...args: unknown[]) => mockUseGitHubConfig(...args),
}));

vi.mock("@/hooks/useGitStatus", () => ({
  useGitStatus: (...args: unknown[]) => mockUseGitStatus(...args),
}));

vi.mock("@/hooks/useProvidersAvailable", () => ({
  useProvidersAvailable: (...args: unknown[]) => mockUseProvidersAvailable(...args),
}));

vi.mock("@/components/shared/AgentActionsBar", () => ({
  AgentActionsBar: () => <div data-testid="epic-actions" />,
}));

vi.mock("@/components/epic/UserStoryQuickActions", () => ({
  UserStoryQuickActions: () => <div data-testid="story-quick-actions" />,
}));

vi.mock("@/components/story/CommentThread", () => ({
  CommentThread: () => <div data-testid="comment-thread" />,
}));

vi.mock("@/components/dependencies/DependencyEditor", () => ({
  DependencyEditor: () => <div data-testid="dependency-editor" />,
}));

describe("EpicDetail delete flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockUseEpicDetail.mockReturnValue({
      epic: {
        id: "epic-1",
        title: "Payments",
        description: "Epic details",
        priority: 1,
        status: "todo",
        branchName: null,
        prNumber: null,
        prUrl: null,
        prStatus: null,
        type: "feature",
        linkedEpicId: null,
        images: null,
      },
      userStories: [],
      loading: false,
      updateEpic: vi.fn(),
      addUserStory: vi.fn(),
      updateUserStory: vi.fn(),
      deleteUserStory: vi.fn(),
      refresh: vi.fn(),
      setPolling: vi.fn(),
    });
    mockUseTicketComments.mockReturnValue({
      comments: [],
      loading: false,
      addComment: vi.fn(),
    });
    mockUseAgentDispatch.mockReturnValue({
      activeSession: null,
      dispatching: false,
      isRunning: false,
      sendToDev: vi.fn(),
      sendToReview: vi.fn(),
      resolveMerge: vi.fn(),
      approve: vi.fn(),
    });
    mockUseEpicPr.mockReturnValue({
      pr: null,
      loading: false,
      error: null,
      createPr: vi.fn(),
      syncPr: vi.fn(),
    });
    mockUseGitHubConfig.mockReturnValue({ isConfigured: false });
    mockUseGitStatus.mockReturnValue({
      ahead: 0,
      behind: 0,
      loading: false,
      error: null,
      refresh: vi.fn(),
      push: vi.fn(),
      pushing: false,
    });
    mockUseProvidersAvailable.mockReturnValue({
      codexAvailable: true,
      codexInstalled: true,
    });
  });

  function renderSubject(overrides?: Partial<ComponentProps<typeof EpicDetail>>) {
    const onClose = vi.fn();
    const onDeleted = vi.fn();

    render(
      <EpicDetail
        projectId="proj-1"
        epicId="epic-1"
        open={true}
        onClose={onClose}
        onDeleted={onDeleted}
        {...overrides}
      />,
    );

    return { onClose, onDeleted };
  }

  /**
   * Delete lives behind the header's overflow menu now — the in-flow danger
   * zone was removed in the 3a redesign.
   */
  async function openDeleteDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId("epic-overflow-menu"));
    await waitFor(() => {
      expect(screen.getByTestId("epic-delete-menu-item")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("epic-delete-menu-item"));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm Delete" }),
      ).toBeInTheDocument();
    });
  }

  it("shows confirmation dialog with irreversible warning", async () => {
    renderSubject();
    await openDeleteDialog();
    expect(screen.getByRole("heading", { name: "Delete Epic" })).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
  });

  it("renders as non-modal inline panel without sheet overlay", () => {
    renderSubject();
    expect(screen.getByTestId("epic-detail-panel")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
  });

  it("submits exactly one delete request while in-flight", async () => {
    // Definite assignment: the executor runs synchronously, but TS cannot see
    // through the callback — a `| null` union would narrow to `null` below.
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return fetchPromise;
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { onClose, onDeleted } = renderSubject();
    await openDeleteDialog();
    const confirmButton = screen.getByRole("button", { name: "Confirm Delete" });

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE"
    );
    expect(deleteCalls).toHaveLength(1);
    expect(confirmButton).toBeDisabled();

    resolveFetch({
      ok: true,
      json: async () => ({ data: { deleted: true } }),
    });

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("shows backend error when delete fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Delete blocked by dependency" }),
    }) as unknown as typeof fetch;

    const { onClose, onDeleted } = renderSubject();
    await openDeleteDialog();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));

    await waitFor(() => {
      expect(screen.getByText("Delete blocked by dependency")).toBeInTheDocument();
    });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
