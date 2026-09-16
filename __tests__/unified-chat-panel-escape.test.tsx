/**
 * Escape inside the project chat panel belongs to whatever is being edited or
 * confirmed, not to the panel (lot 10 corrections).
 *
 * - Mobile: the panel is a real Radix Sheet, which listens for Escape on the
 *   document in the CAPTURE phase — before the rename field's React handler
 *   can stop it. Without a guard the sheet closed and unmounted the edit.
 * - Desktop: the panel collapses on a window-level Escape; the rename field
 *   and the delete confirmation dialog handle the key first.
 *
 * The real `@/components/ui/sheet` is used on purpose: the mobile-persist
 * suite mocks it and so cannot see the capture-phase listener.
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const baseConversations = [
  { id: "conv1", projectId: "proj1", type: "brainstorm", label: "Alpha", status: "active", epicId: null, provider: "claude-code", createdAt: "2024-01-01" },
  { id: "conv2", projectId: "proj1", type: "brainstorm", label: "Beta", status: "active", epicId: null, provider: "claude-code", createdAt: "2024-01-02" },
];
const mockUpdateConversation = vi.fn(async () => null);
const mockDeleteConversation = vi.fn(async () => true);

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: baseConversations,
    activeId: "conv1",
    setActiveId: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: mockUpdateConversation,
    deleteConversation: mockDeleteConversation,
    restartPersistentSession: vi.fn(),
    hasPendingMutation: () => false,
    refresh: vi.fn(),
    loading: false,
    mutating: false,
    error: null,
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
  useEpicCreate: () => ({ draftEpic: vi.fn(async () => true), isLoading: false, error: null }),
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

vi.mock("@/components/chat-page/ChatThread", () => ({
  ChatThread: () => <div data-testid="chat-thread" />,
}));

vi.mock("@/components/chat-page/ChatComposer", () => ({
  ChatComposer: () => <div data-testid="chat-composer" />,
}));

import { UnifiedChatPanel } from "@/components/chat/UnifiedChatPanel";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

async function openPanel() {
  render(
    <UnifiedChatPanel projectId="proj1" onOpenTicket={vi.fn()} onToast={vi.fn()}>
      <div data-testid="board-content">board</div>
    </UnifiedChatPanel>,
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
  });
}

function startRename() {
  fireEvent.click(screen.getByRole("button", { name: "Rename conversation" }));
  const field = screen.getByRole("textbox", { name: "Conversation name" });
  fireEvent.change(field, { target: { value: "Abandoned" } });
  return field;
}

describe("UnifiedChatPanel — Escape belongs to the edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("mobile: Escape in the rename field cancels the edit and keeps the sheet open", async () => {
    setViewport(600);
    await openPanel();
    expect(screen.getByTestId("unified-panel-mobile-sheet")).toBeInTheDocument();

    const field = startRename();
    await act(async () => {
      fireEvent.keyDown(field, { key: "Escape" });
    });

    expect(screen.getByTestId("unified-panel-mobile-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-chat-strip")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Conversation name" })).toBeNull();
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("mobile: Escape elsewhere in the sheet still dismisses it", async () => {
    setViewport(600);
    await openPanel();
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("unified-panel-mobile-sheet"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.getByTestId("collapsed-chat-strip")).toBeInTheDocument());
  });

  it("desktop: Escape in the rename field does not collapse the panel", async () => {
    setViewport(1200);
    await openPanel();
    const field = startRename();
    await act(async () => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("desktop: Escape dismisses the delete confirmation, not the panel", async () => {
    setViewport(1200);
    await openPanel();
    const cards = screen.getAllByTestId("chat-roster-card");
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Delete conversation" }));
    const dialog = await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("unified-panel-expanded")).toBeInTheDocument();
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });
});
