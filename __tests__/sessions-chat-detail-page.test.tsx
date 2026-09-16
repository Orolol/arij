/**
 * Conversation detail under /projects/:id/sessions/chat/:conversationId: the
 * identity line names the conversation kind. The page recognizes
 * `epic_creation` (what every creator writes) as well as the legacy `epic` —
 * the detail route normalizes it now, but the page does not rely on that —
 * and names the kind with a catalogue word rather than the stored enum value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatDetailPage from "@/app/projects/[projectId]/sessions/chat/[conversationId]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1", conversationId: "conv-1" }),
}));

vi.mock("@/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

function conversation(overrides: Record<string, unknown>) {
  return {
    id: "conv-1",
    projectId: "proj-1",
    type: "brainstorm",
    label: "Planning the importer",
    status: "active",
    epicId: null,
    provider: "claude-code",
    namedAgentId: null,
    namedAgentName: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function mockConversation(meta: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: String(url).includes("/conversations/") ? meta : [],
      }),
    }))
  );
}

async function renderIdentity() {
  render(<ChatDetailPage />);
  return screen.findByTestId("conversation-identity");
}

describe("ChatDetailPage — conversation kind", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // restoreAllMocks() leaves stubbed globals in place: without this the fetch
  // stub outlives the file in a shared worker.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["epic_creation", "Epic creation"],
    ["epic", "Epic creation"],
  ])("draws a %s conversation with the epic icon and a word", async (type, word) => {
    mockConversation(conversation({ type }));
    const identity = await renderIdentity();

    expect(identity.querySelector("svg.lucide-sparkles")).not.toBeNull();
    expect(screen.getByTestId("conversation-kind")).toHaveTextContent(word);
    expect(identity).not.toHaveTextContent("epic_creation");
  });

  it.each([
    ["brainstorm", "Brainstorm"],
    ["chat", "Chat"],
  ])("draws a %s conversation with the chat icon", async (type, word) => {
    mockConversation(conversation({ type }));
    const identity = await renderIdentity();

    expect(identity.querySelector("svg.lucide-sparkles")).toBeNull();
    expect(identity.querySelector("svg.lucide-message-square")).not.toBeNull();
    expect(screen.getByTestId("conversation-kind")).toHaveTextContent(word);
  });

  it("falls back to the stored value for a kind it does not know", async () => {
    mockConversation(conversation({ type: "custom_flow" }));
    await renderIdentity();

    expect(screen.getByTestId("conversation-kind")).toHaveTextContent("custom_flow");
  });
});
