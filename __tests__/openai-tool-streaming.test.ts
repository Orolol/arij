/**
 * Client-level tests for the tool-calling additions to the OpenAI-compatible
 * fast-mode client (`lib/openai/client.ts`):
 *
 *   - streamOpenAiChatEvents assembling streamed `delta.tool_calls`
 *     fragments into complete OpenAiToolCall objects,
 *   - buildChatCompletionsBody including `tools` only when given,
 *   - the non-streaming JSON fallback surfacing `message.tool_calls`,
 *   - the text-only streamOpenAiChatCompletion wrapper staying text-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import {
  buildChatCompletionsBody,
  streamOpenAiChatCompletion,
  streamOpenAiChatEvents,
  type OpenAiChatMessage,
  type OpenAiConfig,
  type OpenAiStreamEvent,
  type OpenAiToolDefinition,
} from "@/lib/openai/client";

const baseConfig: OpenAiConfig = {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "sk-test",
  model: "llama3.1",
  reasoningEffort: "off",
};

const messages: OpenAiChatMessage[] = [{ role: "user", content: "Hello" }];

const toolDefinitions: OpenAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_tickets",
      description: "List tickets on the board",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "move_ticket",
      description: "Move a ticket to a column",
      parameters: {
        type: "object",
        properties: { ticketId: { type: "string" } },
        required: ["ticketId"],
      },
    },
  },
];

/** Builds a 200 response whose body is fed chunk by chunk. */
function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** One `data: {json}\n\n` SSE chunk. */
function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** SSE chunk carrying `choices[0].delta.tool_calls` fragments. */
function toolCallDeltaChunk(fragments: unknown[]): string {
  return sseChunk({ choices: [{ delta: { tool_calls: fragments } }] });
}

async function collectEvents(
  stream: AsyncGenerator<OpenAiStreamEvent, void, unknown>,
): Promise<OpenAiStreamEvent[]> {
  const out: OpenAiStreamEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

async function collectText(
  stream: AsyncGenerator<string, void, unknown>,
): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of stream) out.push(delta);
  return out;
}

describe("streamOpenAiChatEvents — tool call assembly", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("assembles tool_call fragments split across SSE chunks into one event after [DONE]", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        // First fragment carries id + name, arguments trickle in afterwards.
        toolCallDeltaChunk([
          {
            index: 0,
            id: "call_abc",
            type: "function",
            function: { name: "move_ticket", arguments: "" },
          },
        ]),
        toolCallDeltaChunk([{ index: 0, function: { arguments: '{"ticketId":' } }]),
        toolCallDeltaChunk([{ index: 0, function: { arguments: '"T-1"}' } }]),
        "data: [DONE]\n\n",
        // Fragments after [DONE] must not pollute the assembled call.
        toolCallDeltaChunk([{ index: 0, function: { arguments: "IGNORED" } }]),
      ]),
    );

    const events = await collectEvents(
      streamOpenAiChatEvents(baseConfig, messages, { tools: toolDefinitions }),
    );

    expect(events).toEqual([
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "move_ticket", arguments: '{"ticketId":"T-1"}' },
          },
        ],
      },
    ]);

    // The advertised tools rode along in the request body.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual(toolDefinitions);
  });

  it("assembles multiple parallel tool calls in index order", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        // Index 1 starts streaming BEFORE index 0 — finalize must sort.
        toolCallDeltaChunk([
          { index: 1, id: "call_two", function: { name: "move_ticket", arguments: "" } },
        ]),
        toolCallDeltaChunk([
          { index: 0, id: "call_one", function: { name: "list_tickets", arguments: "" } },
        ]),
        toolCallDeltaChunk([
          { index: 1, function: { arguments: '{"ticketId":"T-9"}' } },
          { index: 0, function: { arguments: '{"status":' } },
        ]),
        toolCallDeltaChunk([{ index: 0, function: { arguments: '"open"}' } }]),
        "data: [DONE]\n\n",
      ]),
    );

    const events = await collectEvents(
      streamOpenAiChatEvents(baseConfig, messages, { tools: toolDefinitions }),
    );

    expect(events).toEqual([
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "call_one",
            type: "function",
            function: { name: "list_tickets", arguments: '{"status":"open"}' },
          },
          {
            id: "call_two",
            type: "function",
            function: { name: "move_ticket", arguments: '{"ticketId":"T-9"}' },
          },
        ],
      },
    ]);
  });

  it("yields text deltas as they arrive and still emits the tool_calls event at the end", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        sseChunk({ choices: [{ delta: { content: "Let me " } }] }),
        sseChunk({ choices: [{ delta: { content: "check." } }] }),
        toolCallDeltaChunk([
          { index: 0, id: "call_1", function: { name: "list_tickets", arguments: "{}" } },
        ]),
        "data: [DONE]\n\n",
      ]),
    );

    const events = await collectEvents(
      streamOpenAiChatEvents(baseConfig, messages, { tools: toolDefinitions }),
    );

    expect(events).toEqual([
      { type: "text", text: "Let me " },
      { type: "text", text: "check." },
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "list_tickets", arguments: "{}" },
          },
        ],
      },
    ]);
  });

  it("surfaces message.content and message.tool_calls from a non-streaming JSON fallback", async () => {
    // Server that ignores `stream: true` and answers with one completion.
    fetchMock.mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: "Moving it now.",
              tool_calls: [
                {
                  id: "call_a",
                  type: "function",
                  function: { name: "list_tickets", arguments: "{}" },
                },
                {
                  id: "call_b",
                  type: "function",
                  function: { name: "move_ticket", arguments: '{"ticketId":"T-2"}' },
                },
              ],
            },
          },
        ],
      }),
    );

    const events = await collectEvents(
      streamOpenAiChatEvents(baseConfig, messages, { tools: toolDefinitions }),
    );

    expect(events).toEqual([
      { type: "text", text: "Moving it now." },
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "call_a",
            type: "function",
            function: { name: "list_tickets", arguments: "{}" },
          },
          {
            id: "call_b",
            type: "function",
            function: { name: "move_ticket", arguments: '{"ticketId":"T-2"}' },
          },
        ],
      },
    ]);
  });

  it("drops nameless fragments, backfills missing ids as call_N and empty arguments as {}", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        toolCallDeltaChunk([
          // No id, no arguments: gets call_0 and "{}".
          { index: 0, function: { name: "list_tickets" } },
          // No id, real arguments: gets call_1.
          { index: 1, function: { name: "move_ticket", arguments: '{"ticketId":"T-3"}' } },
          // Arguments but never a name: dropped by finalize.
          { index: 2, id: "call_orphan", function: { arguments: '{"x":1}' } },
        ]),
        "data: [DONE]\n\n",
      ]),
    );

    const events = await collectEvents(
      streamOpenAiChatEvents(baseConfig, messages, { tools: toolDefinitions }),
    );

    expect(events).toEqual([
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "call_0",
            type: "function",
            function: { name: "list_tickets", arguments: "{}" },
          },
          {
            id: "call_1",
            type: "function",
            function: { name: "move_ticket", arguments: '{"ticketId":"T-3"}' },
          },
        ],
      },
    ]);
  });

  it("emits no tool_calls event when every fragment is nameless", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        toolCallDeltaChunk([{ index: 0, id: "call_x", function: { arguments: "{}" } }]),
        sseChunk({ choices: [{ delta: { content: "Just text." } }] }),
        "data: [DONE]\n\n",
      ]),
    );

    const events = await collectEvents(
      streamOpenAiChatEvents(baseConfig, messages, { tools: toolDefinitions }),
    );

    expect(events).toEqual([{ type: "text", text: "Just text." }]);
  });
});

describe("buildChatCompletionsBody — tools field", () => {
  it("includes tools when a non-empty array is passed", () => {
    const body = buildChatCompletionsBody(baseConfig, messages, true, toolDefinitions);
    expect(body.tools).toEqual(toolDefinitions);
    expect(body).toMatchObject({ model: "llama3.1", stream: true });
  });

  it("omits tools for an empty array", () => {
    const body = buildChatCompletionsBody(baseConfig, messages, true, []);
    expect(body).not.toHaveProperty("tools");
  });

  it("omits tools when the argument is not given", () => {
    const body = buildChatCompletionsBody(baseConfig, messages, true);
    expect(body).not.toHaveProperty("tools");
    expect(body).toEqual({ model: "llama3.1", messages, stream: true });
  });
});

describe("streamOpenAiChatCompletion — text-only wrapper", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields only text even when the stream carries tool calls", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        sseChunk({ choices: [{ delta: { content: "Hel" } }] }),
        toolCallDeltaChunk([
          { index: 0, id: "call_1", function: { name: "list_tickets", arguments: "{}" } },
        ]),
        sseChunk({ choices: [{ delta: { content: "lo" } }] }),
        "data: [DONE]\n\n",
      ]),
    );

    const deltas = await collectText(streamOpenAiChatCompletion(baseConfig, messages));
    expect(deltas).toEqual(["Hel", "lo"]);
  });
});
