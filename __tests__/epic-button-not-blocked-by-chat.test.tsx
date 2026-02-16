import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
    createEpic: vi.fn(),
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

vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => <div data-testid="named-agent-select" />,
}));

import { UnifiedChatPanel } from "@/components/chat/UnifiedChatPanel";

describe("Epic button not blocked by chat activity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it("epic button is enabled even when conversation status is generating", () => {
    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const button = screen.getByText("Create Epic & Generate Stories");
    expect(button).not.toBeDisabled();
  });

  it("epic button is enabled even when useChat sending is true", () => {
    mockSending = true;

    render(
      <UnifiedChatPanel projectId="proj1">
        <div>board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    const button = screen.getByText("Create Epic & Generate Stories");
    expect(button).not.toBeDisabled();
  });

  it("epic button is enabled when only user messages exist", () => {
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
