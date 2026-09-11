/**
 * "Generate Spec & Plan" on the chat page (#108) — the surface half.
 *
 * The hook's own contract lives in spec-generation-hook-result.test.tsx; the
 * other chat tests mock the hook away, so nothing pinned that the page
 * actually scopes the generation to the ACTIVE conversation or says what
 * happened. Here the hook is a spy:
 *
 *   - it is handed the active conversation, not the conversation's provider
 *     (a key the route never read),
 *   - a success raises a toast naming how many epics landed and offers the
 *     link to the spec — and an epics-only answer (spec left unchanged)
 *     does not claim a spec was written,
 *   - a failed generation (null) raises no success toast.
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ChatMessage } from "@/hooks/useChat";
import type { Conversation } from "@/hooks/useConversations";
import type { ControlDeskPayload, DeskProject } from "@/lib/control-desk/types";

const PROJECT: DeskProject = {
  id: "p1",
  name: "Arij",
  shortName: "ARIJ",
  colorIndex: 0,
  activeAgents: 0,
  autoModeEnabled: false,
};

const CONVERSATIONS: Conversation[] = [
  {
    id: "conv-1",
    projectId: "p1",
    type: "brainstorm",
    label: "Brainstorm",
    status: "active",
    epicId: null,
    provider: "codex",
    createdAt: "2026-09-01T08:00:00.000Z",
  },
];

const MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    projectId: "p1",
    role: "user",
    content: "Let's build a CLI.",
    createdAt: "2026-09-02T08:01:00.000Z",
  },
  {
    id: "m2",
    projectId: "p1",
    role: "assistant",
    content: "Here is a plan.",
    createdAt: "2026-09-02T08:02:00.000Z",
  },
];

const DESK: ControlDeskPayload = {
  generatedAt: "2026-09-05T10:00:00.000Z",
  projects: [PROJECT],
  working: [],
  queued: [],
  today: {
    merged: 0,
    released: 0,
    failed: 0,
    reviewed: 0,
  } as unknown as ControlDeskPayload["today"],
  yourTurn: { awaitingReply: [], failed: [], conflicts: [] },
  readyToLand: [],
  heldBackCount: 0,
  upNext: [],
};

const spec = vi.hoisted(() => ({
  useSpecGeneration: vi.fn(),
  generateSpec: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/useControlDesk", () => ({
  useControlDesk: () => ({ data: DESK, loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: CONVERSATIONS,
    activeId: "conv-1",
    setActiveId: vi.fn(),
    loading: false,
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    restartPersistentSession: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: MESSAGES,
    setMessages: vi.fn(),
    loading: false,
    sending: false,
    error: null,
    pendingQuestions: null,
    streamStatus: null,
    sendMessage: vi.fn(),
    answerQuestions: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [], loading: false, refresh: vi.fn() }),
}));

vi.mock("@/hooks/useSpecGeneration", () => ({
  useSpecGeneration: spec.useSpecGeneration,
}));

vi.mock("@/hooks/useEpicCreate", () => ({
  useEpicCreate: () => ({ createEpic: vi.fn(), isLoading: false, error: null, createdEpic: null }),
}));

vi.mock("@/hooks/usePolling", () => ({ usePolling: () => {} }));

const { ChatPageView } = await import("@/components/chat-page/ChatPageView");

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
  window.localStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: [] }),
  }) as unknown as typeof fetch;
  spec.useSpecGeneration.mockReturnValue({
    generateSpec: spec.generateSpec,
    generating: false,
    error: null,
    result: null,
  });
});

async function renderChat() {
  await act(async () => {
    render(<ChatPageView initialProjectId="p1" />);
  });
}

describe("chat page — Generate Spec & Plan", () => {
  it("scopes the generation to the active conversation", async () => {
    await renderChat();

    expect(spec.useSpecGeneration).toHaveBeenCalledWith("p1", { conversationId: "conv-1" });
  });

  it("says how many epics landed and links to the spec", async () => {
    spec.generateSpec.mockResolvedValue({ spec: "# S", epicsCreated: 2 });
    await renderChat();

    await userEvent.click(screen.getByRole("button", { name: "Generate Spec & Plan" }));

    expect(spec.generateSpec).toHaveBeenCalledOnce();
    expect(await screen.findByText("Spec written — 2 epics created")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "view the spec →" })).toHaveAttribute(
      "href",
      "/projects/p1/spec"
    );
  });

  it("does not claim a spec was written when the agent only returned epics", async () => {
    spec.generateSpec.mockResolvedValue({ spec: null, epicsCreated: 3 });
    await renderChat();

    await userEvent.click(screen.getByRole("button", { name: "Generate Spec & Plan" }));

    expect(await screen.findByText("3 epics created")).toBeInTheDocument();
    expect(screen.queryByText(/Spec written/)).not.toBeInTheDocument();
    // Nothing new on the Spec page to point at.
    expect(screen.queryByRole("link", { name: "view the spec →" })).not.toBeInTheDocument();
  });

  it("raises no success toast when the generation failed", async () => {
    spec.generateSpec.mockResolvedValue(null);
    await renderChat();

    await userEvent.click(screen.getByRole("button", { name: "Generate Spec & Plan" }));

    expect(spec.generateSpec).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Spec written/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "view the spec →" })).not.toBeInTheDocument();
  });
});
