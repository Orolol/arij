import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", async () =>
  (await import("@/__tests__/helpers/next-navigation-mock")).nextNavigationMock(),
);

let mockConversations = [
  {
    id: "conv1",
    projectId: "proj1",
    type: "epic_creation",
    label: "New Epic",
    status: "generating",
    epicId: null,
    provider: "claude-code",
    createdAt: "2024-01-01",
  },
];
let mockActiveId: string | null = "conv1";
let mockSending = false;
const mockCreateEpic = vi.fn(async () => "epic-1");
let mockMessages = [
  { id: "m1", projectId: "proj1", role: "user", content: "Create auth epic", createdAt: "2024-01-01" },
  { id: "m2", projectId: "proj1", role: "assistant", content: "Here is the epic", createdAt: "2024-01-01" },
];

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: mockConversations,
    activeId: mockActiveId,
    setActiveId: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    refresh: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: mockMessages,
    loading: false,
    sending: mockSending,
    pendingQuestions: null,
    streamStatus: null,
    sendMessage: vi.fn(),
    answerQuestions: vi.fn(),
  }),
}));

vi.mock("@/hooks/useEpicCreate", () => ({
  useEpicCreate: () => ({
    createEpic: mockCreateEpic,
    isLoading: false,
    error: null,
    createdEpic: null,
  }),
}));

vi.mock("@/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("@/components/chat/MessageInput", () => ({
  MessageInput: ({ disabled }: { disabled?: boolean }) => (
    <button data-testid="message-input" disabled={disabled}>input</button>
  ),
}));

vi.mock("@/components/chat/QuestionCards", () => ({
  QuestionCards: () => null,
}));

vi.mock("@/components/shared/AgentSelectPill", () => ({
  AgentSelectPill: () => <div data-testid="agent-select" />,
}));

import { UnifiedChatPanel } from "@/components/chat/UnifiedChatPanel";

describe("Epic creation shares the conversation action lock", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mockCreateEpic.mockClear();
    window.localStorage.clear();

    mockConversations = [
      {
        id: "conv1",
        projectId: "proj1",
        type: "epic_creation",
        label: "New Epic",
        status: "generating",
        epicId: null,
        provider: "claude-code",
        createdAt: "2024-01-01",
      },
    ];
    mockActiveId = "conv1";
    mockSending = false;
    mockMessages = [
      { id: "m1", projectId: "proj1", role: "user", content: "Create auth epic", createdAt: "2024-01-01" },
      { id: "m2", projectId: "proj1", role: "assistant", content: "Here is the epic", createdAt: "2024-01-01" },
    ];

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
  });

  it("waits for generation to finish before creating from the current proposal", async () => {
    const view = render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const button = screen.getByText("Create Epic & Generate Stories");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockCreateEpic).not.toHaveBeenCalled();
    mockConversations = mockConversations.map((conversation) => ({ ...conversation, status: "active" }));
    view.rerender(<UnifiedChatPanel projectId="proj1"><div>board</div></UnifiedChatPanel>);
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(mockCreateEpic).toHaveBeenCalledTimes(1));
  });

  it("does not create an epic while a reply is streaming", () => {
    mockConversations[0].status = "active";
    mockSending = true;

    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const button = screen.getByText("Create Epic & Generate Stories");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockCreateEpic).not.toHaveBeenCalled();
  });

  it("can finalize an idle conversation when only user messages exist", async () => {
    mockConversations[0].status = "active";
    mockMessages = [
      { id: "m1", projectId: "proj1", role: "user", content: "Create auth epic", createdAt: "2024-01-01" },
    ];

    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const button = screen.getByText("Create Epic & Generate Stories");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(mockCreateEpic).toHaveBeenCalledTimes(1));
  });

  it("does not offer creation before a user has started the conversation", () => {
    mockConversations[0].status = "active";
    mockMessages = [];
    render(<UnifiedChatPanel projectId="proj1"><div>board</div></UnifiedChatPanel>);
    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    expect(screen.queryByText("Create Epic & Generate Stories")).toBeNull();
    expect(mockCreateEpic).not.toHaveBeenCalled();
  });

  it("message input is still disabled when conversation is busy", () => {
    mockSending = true;

    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const input = screen.getByTestId("message-input");
    expect(input).toBeDisabled();
  });
});
