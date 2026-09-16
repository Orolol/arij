import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", async () =>
  (await import("@/__tests__/helpers/next-navigation-mock")).nextNavigationMock(),
);

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

let mockConversations = [
  {
    id: "conv1",
    projectId: "proj1",
    type: "brainstorm",
    label: "Brainstorm",
    status: "active",
    epicId: null,
    provider: "claude-code",
    createdAt: "2024-01-01",
  },
];
let mockActiveId: string | null = "conv1";
const mockSetActiveId = vi.fn((id: string | null) => {
  mockActiveId = id;
});
const mockCreateConversation = vi.fn(async (input?: { type?: string; label?: string }) => {
  const conversation = {
    id: "conv-new",
    projectId: "proj1",
    type: input?.type || "brainstorm",
    label: input?.label || "Brainstorm",
    status: "active",
    epicId: null,
    provider: "claude-code",
    createdAt: new Date().toISOString(),
  };
  mockConversations = [...mockConversations, conversation];
  mockActiveId = conversation.id;
  return conversation;
});
const mockUpdateConversation = vi.fn();
const mockRefreshConversations = vi.fn();
const mockDeleteConversation = vi.fn();

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: mockConversations,
    activeId: mockActiveId,
    setActiveId: mockSetActiveId,
    createConversation: mockCreateConversation,
    updateConversation: mockUpdateConversation,
    deleteConversation: mockDeleteConversation,
    refresh: mockRefreshConversations,
    loading: false,
  }),
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
  }),
}));

vi.mock("@/hooks/useProvidersAvailable", () => ({
  useProvidersAvailable: () => ({ codexAvailable: true, codexInstalled: true }),
}));

vi.mock("@/hooks/useEpicCreate", () => ({
  useEpicCreate: () => ({
    draftEpic: vi.fn(async () => true),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useSpecGeneration", () => ({
  useSpecGeneration: () => ({ generateSpec: vi.fn(), generating: false, error: null }),
}));

vi.mock("@/hooks/useControlDesk", () => ({
  useControlDesk: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [], loading: false, refresh: vi.fn() }),
}));

// The panel renders the chat page's thread and composer; their own behaviour
// is pinned by chat-page-thread / chat-page-composer.
vi.mock("@/components/chat-page/ChatThread", () => ({
  ChatThread: () => <div data-testid="chat-thread" />,
}));

vi.mock("@/components/chat-page/ChatComposer", () => ({
  ChatComposer: ({ disabled }: { disabled?: boolean }) => (
    <button data-testid="chat-composer" disabled={disabled}>
      input
    </button>
  ),
}));


// Mock Sheet components for mobile testing
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open, onOpenChange }: { children: React.ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) => (
    open ? (
      <div data-testid="sheet-root" data-open={open}>
        {children}
        <button data-testid="sheet-close-trigger" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    ) : null
  ),
  SheetContent: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid={props["data-testid"] || "sheet-content"}>{children}</div>
  ),
  SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}));

import { UnifiedChatPanel, type UnifiedChatPanelHandle } from "@/components/chat/UnifiedChatPanel";
import { act, createRef } from "react";

function setMobileViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 600,
  });
}

function setDesktopViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1200,
  });
}

describe("UnifiedChatPanel mobile responsive behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();

    mockConversations = [
      {
        id: "conv1",
        projectId: "proj1",
        type: "brainstorm",
        label: "Brainstorm",
        status: "active",
        epicId: null,
        provider: "claude-code",
        createdAt: "2024-01-01",
      },
    ];
    mockActiveId = "conv1";

    setDesktopViewport();
  });

  it("uses Sheet/drawer on narrow screens instead of split pane", async () => {
    // Set window width below the 768px mobile breakpoint before render
    setMobileViewport();

    const ref = createRef<UnifiedChatPanelHandle>();

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()} ref={ref}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    // Expand the panel
    await act(async () => {
      fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    });

    // Should render mobile sheet, not desktop split pane
    expect(screen.getByTestId("unified-panel-mobile-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("unified-panel-expanded")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-divider")).not.toBeInTheDocument();
  });

  it("uses desktop split pane on wide screens", () => {
    setDesktopViewport();

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    // Should render desktop split pane, not mobile sheet
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
    expect(screen.queryByTestId("unified-panel-mobile-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-divider")).toBeInTheDocument();
  });

  it("collapses panel when Sheet is dismissed on mobile", async () => {
    setMobileViewport();

    const ref = createRef<UnifiedChatPanelHandle>();

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()} ref={ref}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    });

    expect(screen.getByTestId("unified-panel-mobile-sheet")).toBeInTheDocument();

    // Close the sheet
    fireEvent.click(screen.getByTestId("sheet-close-trigger"));

    // Panel should collapse back
    expect(screen.queryByTestId("unified-panel-mobile-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("collapsed-chat-strip")).toBeInTheDocument();
  });

  it("hides collapse/hide buttons on mobile Sheet", async () => {
    setMobileViewport();

    const ref = createRef<UnifiedChatPanelHandle>();

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()} ref={ref}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    });

    // The collapse and hide buttons should not be present on mobile
    expect(screen.queryByLabelText("Collapse panel")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hide panel")).not.toBeInTheDocument();
  });

  it("shows collapse/hide buttons on desktop expanded panel", () => {
    setDesktopViewport();

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));

    expect(screen.getByLabelText("Collapse panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Hide panel")).toBeInTheDocument();
  });

  it("renders the roster and the chat content inside the mobile Sheet", async () => {
    setMobileViewport();

    const ref = createRef<UnifiedChatPanelHandle>();

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()} ref={ref}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    });

    // The roster, thread and composer all live inside the mobile sheet
    expect(screen.getByTestId("chat-roster")).toBeInTheDocument();
    expect(screen.getByTestId("chat-thread")).toBeInTheDocument();
    expect(screen.getByTestId("chat-composer")).toBeInTheDocument();
  });
});

describe("UnifiedChatPanel panel state persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();

    mockConversations = [
      {
        id: "conv1",
        projectId: "proj1",
        type: "brainstorm",
        label: "Brainstorm",
        status: "active",
        epicId: null,
        provider: "claude-code",
        createdAt: "2024-01-01",
      },
    ];
    mockActiveId = "conv1";

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
  });

  it("persists panel state to localStorage on change", () => {
    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    // Default state is collapsed, and nothing is persisted until the user
    // actually changes it: localStorage now *owns* the panel state rather than
    // mirroring it, so an untouched panel leaves no stored value behind and a
    // future default change still reaches existing users.
    const stateKey = "arij.unified-chat-panel.state.proj1";
    expect(screen.getByTestId("collapsed-chat-strip")).toBeInTheDocument();
    expect(window.localStorage.getItem(stateKey)).toBeNull();

    // Expand the panel
    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    expect(window.localStorage.getItem(stateKey)).toBe("expanded");

    // Collapse via button
    fireEvent.click(screen.getByLabelText("Collapse panel"));
    expect(window.localStorage.getItem(stateKey)).toBe("collapsed");
  });

  it("restores panel state from localStorage on mount", () => {
    // Pre-set state in localStorage
    window.localStorage.setItem("arij.unified-chat-panel.state.proj1", "expanded");

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    // Should restore to expanded
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-chat-strip")).not.toBeInTheDocument();
  });

  it("restores hidden state from localStorage on mount", () => {
    window.localStorage.setItem("arij.unified-chat-panel.state.proj1", "hidden");

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    // Should be hidden (show only the reveal button)
    expect(screen.queryByTestId("collapsed-chat-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unified-panel-expanded")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show chat strip")).toBeInTheDocument();
  });

  it("uses separate storage keys per project", () => {
    window.localStorage.setItem("arij.unified-chat-panel.state.proj1", "expanded");
    window.localStorage.setItem("arij.unified-chat-panel.state.proj2", "collapsed");

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    // proj1 should be expanded
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();

    // proj2 should remain unaffected in localStorage
    expect(window.localStorage.getItem("arij.unified-chat-panel.state.proj2")).toBe("collapsed");
  });

  it("ignores invalid stored panel state values", () => {
    window.localStorage.setItem("arij.unified-chat-panel.state.proj1", "invalid_value");

    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    // Should default to collapsed
    expect(screen.getByTestId("collapsed-chat-strip")).toBeInTheDocument();
  });

  it("persists hidden state via hide button", () => {
    render(
      <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
        <div data-testid="board-content">board</div>
      </UnifiedChatPanel>,
    );

    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
    fireEvent.click(screen.getByLabelText("Hide panel"));

    const stateKey = "arij.unified-chat-panel.state.proj1";
    expect(window.localStorage.getItem(stateKey)).toBe("hidden");
  });
});
