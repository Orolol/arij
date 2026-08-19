import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockPromptBuilder = vi.hoisted(() => ({
  buildChatPrompt: vi.fn(() => "CHAT_PROMPT"),
  buildEpicRefinementPrompt: vi.fn(() => "EPIC_PROMPT"),
  buildTitleGenerationPrompt: vi.fn(() => "TITLE_PROMPT"),
}));

const mockResolveAgentPrompt = vi.hoisted(() => vi.fn());
const mockResolveAgentByNamedId = vi.hoisted(() => vi.fn());
const mockGetProvider = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "id-123"),
}));

vi.mock("@/lib/claude/prompt-builder", () => ({
  buildChatPrompt: mockPromptBuilder.buildChatPrompt,
  buildEpicRefinementPrompt: mockPromptBuilder.buildEpicRefinementPrompt,
  buildTitleGenerationPrompt: mockPromptBuilder.buildTitleGenerationPrompt,
}));

vi.mock("@/lib/claude/spawn", () => ({
  spawnClaudeStream: vi.fn(),
  spawnClaude: vi.fn(),
}));

vi.mock("@/lib/providers", () => ({
  getProvider: mockGetProvider,
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: mockResolveAgentPrompt,
}));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: mockResolveAgentByNamedId,
}));

async function readSseEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  const body = response.body;
  if (!body) return [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<Record<string, unknown>> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        events.push(JSON.parse(line.slice(6)));
      } catch {
        // ignore malformed data lines
      }
    }
  }

  return events;
}

/** SSE body: the given deltas, one `data:` line each, terminated by [DONE]. */
function sseResponse(deltas: string[]): Response {
  const lines = deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join("") + "data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Seeds the DB for a fast-mode conversation:
 * getQueue: [project, conversation, base_url, api_key, model, reasoning_effort]
 * allQueue: [recentMessages(desc order — the route reverses it)]
 */
function seedFastModeConversation(overrides: {
  conversation?: Record<string, unknown>;
  recentMessages?: Array<Record<string, unknown>>;
  /** Pass null to seed no OpenAI settings at all (endpoint not configured). */
  settings?: Partial<Record<string, string>> | null;
} = {}) {
  const settings = overrides.settings === null
    ? null
    : {
        openai_base_url: "http://localhost:11434/v1",
        openai_api_key: "sk-test",
        openai_model: "llama3.1",
        openai_reasoning_effort: "off",
        ...overrides.settings,
      };
  const settingRows = settings
    ? [
        { key: "openai_base_url", value: JSON.stringify(settings.openai_base_url) },
        { key: "openai_api_key", value: JSON.stringify(settings.openai_api_key) },
        { key: "openai_model", value: JSON.stringify(settings.openai_model) },
        { key: "openai_reasoning_effort", value: JSON.stringify(settings.openai_reasoning_effort) },
      ]
    : [];

  dbMockState.getQueue = [
    { id: "proj1", name: "Arij", description: "desc", spec: "spec", gitRepoPath: null },
    overrides.conversation ?? {
      id: "conv1",
      type: "chat",
      provider: "openai-compatible",
      label: "Chat",
      status: "active",
      namedAgentId: null,
    },
    ...settingRows,
  ];

  dbMockState.allQueue = [
    overrides.recentMessages ?? [
      { role: "user", content: "Current question", createdAt: "2026-01-02T10:00:00.000Z" },
      { role: "user", content: "Previous message", createdAt: "2026-01-01T10:00:00.000Z" },
    ],
  ];
}

describe("POST /api/projects/[projectId]/chat/stream — OpenAI-compatible fast mode", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();

    mockPromptBuilder.buildChatPrompt.mockReturnValue("CHAT_PROMPT");
    mockResolveAgentPrompt.mockResolvedValue("Chat system prompt");
    mockResolveAgentByNamedId.mockReturnValue({
      provider: "claude-code",
      model: undefined,
      namedAgentId: null,
    });

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("streams SSE deltas to the client and persists the assistant message", async () => {
    seedFastModeConversation();
    fetchMock.mockResolvedValue(sseResponse(["Hel", "lo"]));

    const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
    const response = await POST(
      mockJsonRequest({ content: "Current question", conversationId: "conv1" }),
      mockRouteContext({ projectId: "proj1" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSseEvents(response);
    expect(events).toEqual([
      { delta: "Hel" },
      { delta: "lo" },
      { done: true, messageId: "id-123" },
    ]);

    // The user message was persisted before the upstream call.
    expect(dbMockState.insertCalls[0]).toMatchObject({
      role: "user",
      content: "Current question",
      conversationId: "conv1",
    });
    // The assistant reply is persisted from the accumulated deltas.
    expect(dbMockState.insertCalls[1]).toMatchObject({
      role: "assistant",
      content: "Hello",
      conversationId: "conv1",
    });
    // Status transition: generating while streaming, active on success.
    expect(dbMockState.updateCalls).toContainEqual({ status: "generating" });
    expect(dbMockState.updateCalls).toContainEqual({ status: "active" });
  });

  it("posts the system prompt plus recent history to /chat/completions with stream: true", async () => {
    seedFastModeConversation();
    fetchMock.mockResolvedValue(sseResponse(["ok"]));

    const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
    const response = await POST(
      mockJsonRequest({ content: "Current question", conversationId: "conv1" }),
      mockRouteContext({ projectId: "proj1" }),
    );
    await readSseEvents(response);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.method).toBe("POST");

    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("llama3.1");
    expect(body.stream).toBe(true);
    // System prompt first, then the history in chronological order (the
    // just-saved user message included).
    expect(body.messages).toEqual([
      { role: "system", content: "Chat system prompt" },
      { role: "user", content: "Previous message" },
      { role: "user", content: "Current question" },
    ]);
  });

  it("sends the Bearer key only when one is configured", async () => {
    seedFastModeConversation({ settings: { openai_api_key: "" } });
    fetchMock.mockResolvedValue(sseResponse(["ok"]));

    const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
    const response = await POST(
      mockJsonRequest({ content: "Current question", conversationId: "conv1" }),
      mockRouteContext({ projectId: "proj1" }),
    );
    await readSseEvents(response);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("omits the system message when no chat system prompt is configured", async () => {
    mockResolveAgentPrompt.mockResolvedValue("   ");
    seedFastModeConversation();
    fetchMock.mockResolvedValue(sseResponse(["ok"]));

    const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
    const response = await POST(
      mockJsonRequest({ content: "Current question", conversationId: "conv1" }),
      mockRouteContext({ projectId: "proj1" }),
    );
    await readSseEvents(response);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string }>;
    };
    expect(body.messages[0]?.role).toBe("user");
  });

  it("rejects image attachments with 400", async () => {
    seedFastModeConversation();
    fetchMock.mockResolvedValue(sseResponse(["ok"]));

    const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
    const response = await POST(
      mockJsonRequest({
        content: "Look at this",
        conversationId: "conv1",
        attachmentIds: ["att-1"],
      }),
      mockRouteContext({ projectId: "proj1" }),
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("attachments are not supported");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the endpoint is not configured", async () => {
    seedFastModeConversation({ settings: null }); // no settings rows -> empty config
    fetchMock.mockResolvedValue(sseResponse(["ok"]));

    const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
    const response = await POST(
      mockJsonRequest({ content: "Hello", conversationId: "conv1" }),
      mockRouteContext({ projectId: "proj1" }),
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps CLI providers on the CLI path (openai branch is provider-scoped)", async () => {
    seedFastModeConversation({
      conversation: {
        id: "conv1",
        type: "brainstorm",
        provider: "gemini-cli",
        label: "Brainstorm",
        status: "active",
        namedAgentId: null,
      },
    });
    mockGetProvider.mockReturnValue({
      spawn: vi.fn(() => ({
        promise: Promise.resolve({ success: true, result: "Codex response" }),
        kill: vi.fn(),
      })),
    });

    const { POST } = await import("@/app/api/projects/[projectId]/chat/stream/route");
    const response = await POST(
      mockJsonRequest({ content: "Current question", conversationId: "conv1" }),
      mockRouteContext({ projectId: "proj1" }),
    );

    expect(response.status).toBe(200);
    await readSseEvents(response);
    expect(mockGetProvider).toHaveBeenCalledWith("gemini-cli");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
