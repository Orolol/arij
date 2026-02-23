import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    loading: false,
    sending: false,
    pendingQuestions: null,
    streamStatus: null,
    sendMessage: vi.fn(),
    answerQuestions: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mockCreateConversation = vi.fn(async (opts: { type?: string; label?: string }) => ({
  id: `new-${opts.type}`,
  projectId: "proj1",
  type: opts.type,
  label: opts.label,
  status: "active",
  epicId: null,
  provider: "claude-code",
  namedAgentId: null,
  createdAt: "2024-01-01",
}));

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: [
      {
        id: "conv1",
        projectId: "proj1",
        type: "brainstorm",
        label: "Brainstorm",
        status: "active",
        epicId: null,
        provider: "claude-code",
        namedAgentId: null,
        createdAt: "2024-01-01",
      },
    ],
    activeId: "conv1",
    setActiveId: vi.fn(),
    createConversation: mockCreateConversation,
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    refresh: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useEpicCreate", () => ({
  useEpicCreate: () => ({
    createEpic: vi.fn(async () => null),
    isLoading: false,
    error: null,
    createdEpic: null,
  }),
}));

vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => <select data-testid="chat-agent-select" />,
}));
vi.mock("@/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));
vi.mock("@/components/chat/MessageInput", () => ({
  MessageInput: () => <button data-testid="send-btn">Send</button>,
}));
vi.mock("@/components/chat/QuestionCards", () => ({
  QuestionCards: () => null,
}));

import { UnifiedChatPanel } from "@/components/chat/UnifiedChatPanel";

describe("New conversation dropdown menu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCreateConversation.mockClear();
    window.localStorage.clear();

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
  });

  function renderExpandedPanel() {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );
    const collapsedStrip = screen.queryByTestId("collapsed-chat-strip");
    if (collapsedStrip) {
      fireEvent.click(collapsedStrip);
    }
  }

  it("renders the + button as a dropdown trigger", () => {
    renderExpandedPanel();
    const trigger = screen.getByTestId("new-conversation-tab");
    expect(trigger).toBeInTheDocument();
  });

  it("shows Brainstorm and New Epic options when + is clicked", async () => {
    renderExpandedPanel();
    const user = userEvent.setup();
    const trigger = screen.getByTestId("new-conversation-tab");
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId("new-tab-brainstorm")).toBeInTheDocument();
      expect(screen.getByTestId("new-tab-epic")).toBeInTheDocument();
    });
  });

  it("creates a brainstorm conversation when Brainstorm is selected", async () => {
    renderExpandedPanel();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-conversation-tab"));

    await waitFor(() => {
      expect(screen.getByTestId("new-tab-brainstorm")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("new-tab-brainstorm"));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledWith({
        type: "brainstorm",
        label: "Brainstorm",
      });
    });
  });

  it("creates an epic_creation conversation when New Epic is selected", async () => {
    renderExpandedPanel();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-conversation-tab"));

    await waitFor(() => {
      expect(screen.getByTestId("new-tab-epic")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("new-tab-epic"));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledWith({
        type: "epic_creation",
        label: "New Epic",
      });
    });
  });
});
