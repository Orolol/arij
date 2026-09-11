/**
 * "Generate Spec & Plan" in the /projects/:id chat panel (#108) — the second
 * surface the finding names, next to the chat page.
 *
 * The hook is NOT mocked: the request really leaves through
 * useSpecGeneration, so this pins the panel end to end —
 *
 *   - the POST is scoped to the panel's active conversation,
 *   - a success says what landed (spec written, how many epics) and links
 *     to the Spec page, instead of a silent router.refresh(),
 *   - an epics-only answer does not claim a spec was written,
 *   - a failure shows the error and no success line.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: [
      {
        id: "conv-brainstorm",
        projectId: "proj1",
        type: "brainstorm",
        label: "Brainstorm",
        status: "active",
        epicId: null,
        provider: "claude-code",
        createdAt: "2026-09-01T08:00:00.000Z",
      },
    ],
    activeId: "conv-brainstorm",
    setActiveId: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    restartPersistentSession: vi.fn(),
    refresh: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: [
      {
        id: "m1",
        projectId: "proj1",
        role: "user",
        content: "Let's build a CLI.",
        createdAt: "2026-09-02T08:01:00.000Z",
      },
    ],
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
  useEpicCreate: () => ({ createEpic: vi.fn(), isLoading: false, error: null, createdEpic: null }),
}));

vi.mock("@/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("@/components/chat/MessageInput", () => ({
  MessageInput: () => <div data-testid="message-input" />,
}));

vi.mock("@/components/chat/QuestionCards", () => ({
  QuestionCards: () => null,
}));

import { UnifiedChatPanel } from "@/components/chat/UnifiedChatPanel";

const fetchMock = vi.fn<typeof fetch>();

function answerGenerateSpec(response: { ok: boolean; status: number; body: unknown }) {
  fetchMock.mockImplementation(async (input) => {
    if (String(input).endsWith("/generate-spec")) {
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.body,
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
  });
}

function generateSpecCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/generate-spec"));
}

async function clickGenerate() {
  render(
    <UnifiedChatPanel projectId="proj1">
      <div>board</div>
    </UnifiedChatPanel>,
  );
  fireEvent.click(screen.getByTestId("collapsed-chat-strip"));
  await userEvent.click(screen.getByRole("button", { name: "Generate Spec & Plan" }));
}

beforeEach(() => {
  fetchMock.mockReset();
  navigation.refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1200 });
});

describe("project chat panel — Generate Spec & Plan", () => {
  it("scopes the request to the active conversation", async () => {
    answerGenerateSpec({ ok: true, status: 200, body: { data: { spec: "# S", epicsCreated: 2 } } });

    await clickGenerate();

    expect(generateSpecCalls()).toEqual([
      [
        "/api/projects/proj1/generate-spec",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: "conv-brainstorm" }),
        },
      ],
    ]);
  });

  it("says what landed and links to the spec", async () => {
    answerGenerateSpec({ ok: true, status: 200, body: { data: { spec: "# S", epicsCreated: 2 } } });

    await clickGenerate();

    expect(await screen.findByText("Spec written — 2 epics created")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the spec →" })).toHaveAttribute(
      "href",
      "/projects/proj1/spec",
    );
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("does not claim a spec was written for an epics-only answer", async () => {
    answerGenerateSpec({ ok: true, status: 200, body: { data: { spec: null, epicsCreated: 1 } } });

    await clickGenerate();

    expect(await screen.findByText("1 epic created")).toBeInTheDocument();
    expect(screen.queryByText(/Spec written/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View the spec →" })).not.toBeInTheDocument();
  });

  it("shows the error and no success line when the generation fails", async () => {
    answerGenerateSpec({
      ok: false,
      status: 409,
      body: { error: "The specification changed while the agent was running." },
    });

    await clickGenerate();

    expect(
      await screen.findByText("The specification changed while the agent was running."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Spec written/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View the spec →" })).not.toBeInTheDocument();
  });
});
