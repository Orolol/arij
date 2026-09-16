/**
 * `UnifiedChatPanel` — the chat beside the project desk.
 *
 * Lot 10, #40: the panel keeps its own SHELL (strip, divider, hide, Escape,
 * polling while visible) and renders the conversation with the chat page's
 * components — `ConversationRoster` (compact), `ChatThread`, `ChatComposer`.
 * The roster is rendered for real here, because every conversation action the
 * panel offers goes through it; the thread and the composer are stubbed down
 * to the props this file reasons about (their own behaviour is pinned by
 * `chat-page-thread` and `chat-page-composer`).
 */
import { createRef, useReducer, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", async () =>
  (await import("@/__tests__/helpers/next-navigation-mock")).nextNavigationMock(),
);

import type { Conversation } from "@/hooks/useConversations";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function row(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv1",
    projectId: "proj1",
    type: "brainstorm",
    label: "Brainstorm du matin",
    status: "active",
    epicId: null,
    provider: "claude-code",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let conversationCounter = 2;
let mockConversations: Conversation[] = [];
let mockActiveId: string | null = "conv1";
const mockSetActiveId = vi.fn((id: string | null) => {
  mockActiveId = id;
});
const mockCreateConversation = vi.fn(async (input?: { type?: string; label?: string }) => {
  const conversation = row({
    id: `conv${conversationCounter}`,
    type: input?.type || "brainstorm",
    label: input?.label || "Brainstorm",
    createdAt: `2024-01-0${conversationCounter}T00:00:00.000Z`,
  });
  conversationCounter += 1;
  mockConversations = [...mockConversations, conversation];
  mockActiveId = conversation.id;
  return conversation;
});
const mockUpdateConversation = vi.fn(async () => null);
const mockRefreshConversations = vi.fn();
const mockDeleteConversation = vi.fn(async (conversationId: string) => {
  mockConversations = mockConversations.filter((conversation) => conversation.id !== conversationId);
  return true;
});

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => {
    const [, renderAgain] = useReducer((count: number) => count + 1, 0);
    return {
      conversations: mockConversations,
      activeId: mockActiveId,
      setActiveId: (id: string | null) => { mockSetActiveId(id); renderAgain(); },
      createConversation: async (input: Parameters<typeof mockCreateConversation>[0]) => {
        const created = await mockCreateConversation(input);
        renderAgain();
        return created;
      },
      updateConversation: mockUpdateConversation,
      deleteConversation: async (id: string) => { const done = await mockDeleteConversation(id); renderAgain(); return done; },
      restartPersistentSession: vi.fn(),
      refresh: mockRefreshConversations,
      hasPendingMutation: () => false,
      loading: false,
      mutating: false,
      error: null,
    };
  },
}));

let mockMessages: Array<{ id: string; projectId: string; role: "user" | "assistant"; content: string; createdAt: string }> = [];
let mockSending = false;
let mockPendingQuestions: unknown = null;

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: mockMessages,
    loading: false,
    sending: mockSending,
    error: null,
    pendingQuestions: mockPendingQuestions,
    streamStatus: null,
    sendMessage: vi.fn(),
    answerQuestions: vi.fn(),
  }),
}));

let mockDrafting = false;
const mockDraftEpic = vi.fn(async () => true);
vi.mock("@/hooks/useEpicCreate", () => ({
  useEpicCreate: () => ({ draftEpic: mockDraftEpic, isLoading: mockDrafting, error: null }),
}));

const mockGenerateSpec = vi.fn();
vi.mock("@/hooks/useSpecGeneration", () => ({
  useSpecGeneration: () => ({ generateSpec: mockGenerateSpec, generating: false, error: null }),
}));

vi.mock("@/hooks/useControlDesk", () => ({
  useControlDesk: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [], loading: false, refresh: vi.fn() }),
}));

vi.mock("@/components/chat-page/ChatThread", () => ({
  ChatThread: ({ emptyMessage, footer, busy }: { emptyMessage: string; footer?: ReactNode; busy: boolean }) => (
    <div data-testid="chat-thread" data-empty={emptyMessage} data-busy={busy ? "" : undefined}>
      {footer}
    </div>
  ),
}));

vi.mock("@/components/chat-page/ChatComposer", () => ({
  ChatComposer: ({ disabled, agentLocked, onSelectProject }: { disabled?: boolean; agentLocked: boolean; onSelectProject?: unknown }) => (
    <div data-testid="chat-composer" data-project-pill={onSelectProject ? "" : undefined}>
      <button type="button" data-testid="composer-send" disabled={disabled}>send</button>
      <button type="button" data-testid="composer-agent" disabled={agentLocked}>agent</button>
    </div>
  ),
}));

import { UnifiedChatPanel, type UnifiedChatPanelHandle } from "@/components/chat/UnifiedChatPanel";

function renderPanel(ref?: React.Ref<UnifiedChatPanelHandle>) {
  return render(
    <UnifiedChatPanel projectId="proj1" ref={ref} onOpenTicket={vi.fn()} onToast={vi.fn()}>
      <div data-testid="board-content">board</div>
    </UnifiedChatPanel>,
  );
}

/** Opens the panel; the expanded state persists across a remount. */
function expand() {
  const strip = screen.queryByTestId("collapsed-chat-strip");
  if (strip) fireEvent.click(strip);
}

beforeEach(() => {
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  conversationCounter = 2;
  mockConversations = [row()];
  mockActiveId = "conv1";
  mockMessages = [];
  mockSending = false;
  mockPendingQuestions = null;
  mockDrafting = false;
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1200 });
});

describe("UnifiedChatPanel — shell", () => {
  it("defaults to collapsed with a visible, labelled strip", () => {
    renderPanel();
    expect(screen.getByTestId("board-content")).toBeInTheDocument();
    expect(screen.getByTestId("collapsed-chat-strip")).toHaveAttribute("aria-label", "Open chat panel");
    expect(screen.queryByTestId("unified-panel-expanded")).toBeNull();
  });

  it("expands beside the board on a strip click", () => {
    renderPanel();
    expand();
    expect(screen.getByTestId("board-content")).toBeInTheDocument();
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
    expect(screen.getByTestId("panel-divider")).toHaveAttribute("aria-label", "Resize panel");
  });

  it("resizes through the divider, clamps both sides and resets on double-click", () => {
    renderPanel();
    expand();
    const divider = screen.getByTestId("panel-divider");
    const ratio = () => Number(window.localStorage.getItem("arij.unified-chat-panel.ratio.proj1"));

    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(window, { clientX: 700 });
    fireEvent.mouseUp(window);
    expect(ratio()).toBeCloseTo(0.4167, 1);

    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(window, { clientX: 1100 });
    fireEvent.mouseUp(window);
    expect(ratio()).toBeCloseTo(0.25, 1); // panel floor: 300px

    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseUp(window);
    expect(ratio()).toBeLessThanOrEqual(0.67); // board floor: 400px
    expect(ratio()).toBeGreaterThanOrEqual(0.65);

    fireEvent.doubleClick(divider);
    expect(window.localStorage.getItem("arij.unified-chat-panel.ratio.proj1")).toBe("0.4000");
  });

  it("collapses on Escape, and hides behind a restore button", () => {
    renderPanel();
    expand();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("unified-panel-expanded")).toBeNull();

    expand();
    fireEvent.click(screen.getByLabelText("Hide panel"));
    expect(screen.queryByTestId("collapsed-chat-strip")).toBeNull();
    fireEvent.click(screen.getByLabelText("Show chat strip"));
    expect(screen.getByTestId("collapsed-chat-strip")).toBeInTheDocument();
  });

  it("polls conversations every 3 seconds only while visible", async () => {
    window.localStorage.setItem("arij.unified-chat-panel.state.proj1", "hidden");
    vi.useFakeTimers();
    renderPanel();

    await vi.advanceTimersByTimeAsync(9000);
    expect(mockRefreshConversations).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Show chat strip"));
    await vi.advanceTimersByTimeAsync(9000);
    expect(mockRefreshConversations).toHaveBeenCalledTimes(3);
  });

  it("badges the strip while a conversation is generating", () => {
    const { unmount } = renderPanel();
    expect(screen.queryByTestId("collapsed-active-badge")).toBeNull();
    unmount();

    mockConversations = [row({ status: "generating" })];
    renderPanel();
    expect(screen.getByTestId("collapsed-active-badge")).toBeInTheDocument();
  });
});

describe("UnifiedChatPanel — one rendering grammar with /chat", () => {
  it("renders the chat page's compact roster, thread and composer, and no tab bar", () => {
    renderPanel();
    expand();

    expect(screen.getByTestId("chat-roster")).toHaveAttribute("data-variant", "compact");
    expect(screen.getByTestId("chat-thread")).toBeInTheDocument();
    // The scope is this page's project: no project pill in the panel.
    expect(screen.getByTestId("chat-composer")).not.toHaveAttribute("data-project-pill");
    expect(screen.queryByTestId("chat-tab-bar")).toBeNull();
    expect(screen.queryByText("THE CHAT KNOWS")).toBeNull();
  });

  it("creates each conversation type from the roster, Chat included, and selects it", async () => {
    const user = userEvent.setup();
    renderPanel();
    expand();

    await user.click(screen.getByTestId("chat-new-conversation"));
    await user.click(await screen.findByTestId("chat-new-conversation-chat"));

    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledWith({ type: "chat", label: "Chat" }),
    );
    expect(mockSetActiveId).toHaveBeenCalledWith("conv2");
    expect(screen.getAllByTestId("chat-roster-card")).toHaveLength(2);
  });

  it("switches conversation from the roster", () => {
    mockConversations = [row(), row({ id: "conv2", label: "Refonte", createdAt: "2024-01-02T00:00:00.000Z" })];
    renderPanel();
    expand();
    fireEvent.click(screen.getAllByTestId("chat-roster-card")[1]);
    expect(mockSetActiveId).toHaveBeenCalledWith("conv2");
  });

  it("deletes a conversation, but never the last one", async () => {
    mockConversations = [row(), row({ id: "conv2", label: "Refonte", createdAt: "2024-01-02T00:00:00.000Z" })];
    renderPanel();
    expand();

    const second = screen.getAllByTestId("chat-roster-card")[1];
    fireEvent.click(within(second).getByRole("button", { name: "Delete conversation" }));
    // The X sits beside the rename pencil: the delete waits for confirmation.
    expect(mockDeleteConversation).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete conversation" }));
    await waitFor(() => expect(mockDeleteConversation).toHaveBeenCalledWith("conv2"));
    await waitFor(() => expect(screen.getAllByTestId("chat-roster-card")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Delete conversation" })).toBeNull();
  });

  it("renames the active conversation through the conversation PATCH", async () => {
    const user = userEvent.setup();
    renderPanel();
    expand();

    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation name" });
    await user.clear(field);
    await user.type(field, "Plan du panneau{Enter}");

    await waitFor(() =>
      expect(mockUpdateConversation).toHaveBeenCalledWith("conv1", { label: "Plan du panneau" }),
    );
    // Escape inside the field belongs to the field, not to the panel.
    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
  });

  it("says in a word which conversation failed its last turn", () => {
    mockConversations = [row({ status: "error" })];
    renderPanel();
    expand();
    expect(screen.getByTestId("chat-roster-status")).toHaveTextContent("Last reply failed");
  });
});

describe("UnifiedChatPanel — next steps and locks", () => {
  it("offers Draft the epic on an epic conversation with a user message, and it only drafts", async () => {
    mockConversations = [row({ type: "epic_creation", label: "New Epic" })];
    mockMessages = [{ id: "m1", projectId: "proj1", role: "user", content: "Un epic d'auth", createdAt: "2024-01-01" }];
    renderPanel();
    expand();

    expect(screen.getByTestId("chat-thread")).toHaveAttribute(
      "data-empty",
      "Describe your epic idea and I'll help you structure it with user stories and acceptance criteria.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft the epic" }));
    await waitFor(() => expect(mockDraftEpic).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /Generate Spec/ })).toBeNull();
  });

  it("stops offering Draft the epic once a message already drafted one", () => {
    mockConversations = [row({ type: "epic_creation", label: "New Epic" })];
    mockMessages = [
      { id: "m1", projectId: "proj1", role: "user", content: "Un epic d'auth", createdAt: "2024-01-01" },
      {
        id: "m2",
        projectId: "proj1",
        role: "assistant",
        content: '```json\n{"title":"Auth","description":"x","userStories":[{"title":"As a user, I want login"}]}\n```',
        createdAt: "2024-01-01",
      },
    ];
    renderPanel();
    expand();
    expect(screen.queryByRole("button", { name: "Draft the epic" })).toBeNull();
  });

  it("offers spec generation on a brainstorm, never the epic draft", () => {
    mockMessages = [{ id: "m1", projectId: "proj1", role: "user", content: "Idée", createdAt: "2024-01-01" }];
    renderPanel();
    expand();
    expect(screen.getByRole("button", { name: "Generate Spec & Plan" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Draft the epic" })).toBeNull();
  });

  it("disables the next steps and the composer while a reply streams", () => {
    mockSending = true;
    mockMessages = [{ id: "m1", projectId: "proj1", role: "user", content: "Idée", createdAt: "2024-01-01" }];
    renderPanel();
    expand();
    expect(screen.getByTestId("composer-send")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generate Spec & Plan" })).toBeDisabled();
  });

  it("keeps a conversation writable while ANOTHER one is generating", () => {
    mockConversations = [row(), row({ id: "conv2", status: "generating", createdAt: "2024-01-02T00:00:00.000Z" })];
    renderPanel();
    expand();
    expect(screen.getByTestId("composer-send")).toBeEnabled();
  });

  it("locks the composer while the active conversation is generating, unless it asks a question", () => {
    mockConversations = [row({ status: "generating" })];
    const { unmount } = renderPanel();
    expand();
    expect(screen.getByTestId("composer-send")).toBeDisabled();
    unmount();

    mockPendingQuestions = [{ question: "Which scope?", options: [] }];
    renderPanel();
    expand();
    expect(screen.getByTestId("composer-send")).toBeEnabled();
  });

  it("locks the agent picker once the conversation has a message", () => {
    const { unmount } = renderPanel();
    expand();
    expect(screen.getByTestId("composer-agent")).toBeEnabled();
    unmount();

    mockMessages = [{ id: "m1", projectId: "proj1", role: "user", content: "Idée", createdAt: "2024-01-01" }];
    renderPanel();
    expand();
    expect(screen.getByTestId("composer-agent")).toBeDisabled();
  });
});

describe("UnifiedChatPanel — imperative handle", () => {
  it("exposes openNewEpic only, which opens the panel on a new epic conversation", async () => {
    const ref = createRef<UnifiedChatPanelHandle>();
    renderPanel(ref);
    expect(Object.keys(ref.current ?? {})).toEqual(["openNewEpic"]);

    act(() => {
      ref.current!.openNewEpic();
    });
    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledWith({ type: "epic_creation", label: "New Epic" }),
    );
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
  });

  it("creates the first Brainstorm from the strip on a genuinely empty project", async () => {
    mockConversations = [];
    mockActiveId = null;
    renderPanel();
    expand();
    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledWith({ type: "brainstorm", label: "Brainstorm" }),
    );
  });
});
