import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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

vi.mock("@/components/dependencies/DependencyEditor", () => ({
  DependencyEditor: () => <div data-testid="dependency-editor" />,
}));

describe("EpicDetail mark-read on mount", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderSubject(overrides?: Partial<ComponentProps<typeof EpicDetail>>) {
    return render(
      <EpicDetail
        projectId="proj-1"
        epicId="epic-1"
        open={true}
        onClose={vi.fn()}
        {...overrides}
      />
    );
  }

  function markReadCalls() {
    return fetchSpy.mock.calls.filter(
      ([url]: [string]) => url === "/api/inbox/read"
    );
  }

  it("POSTs /api/inbox/read for the epic when opened", async () => {
    renderSubject();

    await waitFor(() => {
      expect(markReadCalls()).toHaveLength(1);
    });
    expect(markReadCalls()[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ epicId: "epic-1" }),
    });
  });

  it("does not mark read when closed or without an epic", async () => {
    const { unmount } = renderSubject({ open: false });
    unmount();
    renderSubject({ epicId: null });

    await new Promise((r) => setTimeout(r, 20));
    expect(markReadCalls()).toHaveLength(0);
  });

  it("marks the new epic read when switching tickets while open", async () => {
    const { rerender } = renderSubject();
    await waitFor(() => expect(markReadCalls()).toHaveLength(1));

    rerender(
      <EpicDetail
        projectId="proj-1"
        epicId="epic-2"
        open={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(markReadCalls()).toHaveLength(2));
    expect(markReadCalls()[1][1]).toMatchObject({
      body: JSON.stringify({ epicId: "epic-2" }),
    });
  });

  it("survives a failing mark-read call", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));

    const { getByTestId } = renderSubject();

    await new Promise((r) => setTimeout(r, 20));
    expect(getByTestId("epic-detail-panel")).toBeInTheDocument();
  });
});
