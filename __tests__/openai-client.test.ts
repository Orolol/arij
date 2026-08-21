import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import {
  buildChatCompletionsBody,
  buildChatCompletionsUrl,
  buildOpenAiHeaders,
  describeNetworkError,
  streamOpenAiChatCompletion,
  testOpenAiConnection,
  type OpenAiChatMessage,
  type OpenAiConfig,
} from "@/lib/openai/client";

const baseConfig: OpenAiConfig = {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "sk-test",
  model: "llama3.1",
  reasoningEffort: "off",
};

const messages: OpenAiChatMessage[] = [
  { role: "user", content: "Hello" },
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

async function collect(stream: AsyncGenerator<string, void, unknown>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of stream) out.push(delta);
  return out;
}

describe("buildChatCompletionsUrl", () => {
  it("appends /chat/completions and tolerates trailing slashes", () => {
    expect(buildChatCompletionsUrl("http://host/v1")).toBe("http://host/v1/chat/completions");
    expect(buildChatCompletionsUrl("http://host/v1/")).toBe("http://host/v1/chat/completions");
    expect(buildChatCompletionsUrl("http://host/v1///")).toBe("http://host/v1/chat/completions");
  });
});

describe("buildOpenAiHeaders", () => {
  it("sends a Bearer Authorization header when a key is set", () => {
    expect(buildOpenAiHeaders("sk-abc")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-abc",
    });
  });

  it("omits Authorization for keyless local servers", () => {
    const headers = buildOpenAiHeaders("");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBeUndefined();
  });
});

describe("buildChatCompletionsBody", () => {
  it("includes reasoning_effort only when it is not off", () => {
    const off = buildChatCompletionsBody(baseConfig, messages, true);
    expect(off).toEqual({ model: "llama3.1", messages, stream: true });
    expect(off).not.toHaveProperty("reasoning_effort");

    const medium = buildChatCompletionsBody(
      { ...baseConfig, reasoningEffort: "medium" },
      messages,
      true,
    );
    expect(medium).toMatchObject({ reasoning_effort: "medium", stream: true });
  });

  it("passes the stream flag through", () => {
    expect(buildChatCompletionsBody(baseConfig, messages, false)).toMatchObject({
      stream: false,
    });
  });
});

describe("describeNetworkError", () => {
  it("describes aborts as timeouts", () => {
    const abort = new Error("Aborted");
    abort.name = "AbortError";
    expect(describeNetworkError(abort)).toBe("OpenAI-compatible API error: request timed out.");
  });

  it("maps fetch TypeError cause codes to readable messages", () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    expect(describeNetworkError(refused)).toBe(
      "OpenAI-compatible API error: connection refused — is the server running.",
    );

    const dns = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    });
    expect(describeNetworkError(dns)).toBe("OpenAI-compatible API error: host not found.");
  });

  it("falls back to a generic connection failure", () => {
    expect(describeNetworkError(new TypeError("fetch failed"))).toBe(
      "OpenAI-compatible API error: could not connect.",
    );
    expect(describeNetworkError("mystery")).toBe("OpenAI-compatible API error: request failed.");
  });
});

describe("streamOpenAiChatCompletion", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields token-by-token deltas from SSE chunks and stops at [DONE]", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n",
        // Anything after [DONE] must be ignored.
        'data: {"choices":[{"delta":{"content":" ignored"}}]}\n\n',
      ]),
    );

    const deltas = await collect(streamOpenAiChatCompletion(baseConfig, messages));
    expect(deltas).toEqual(["Hel", "lo", " world"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe("llama3.1");
    expect(body.messages).toEqual(messages);
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
  });

  it("emits a non-streaming JSON completion as a single delta", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "The whole answer" } }],
      }),
    );

    const deltas = await collect(streamOpenAiChatCompletion(baseConfig, messages));
    expect(deltas).toEqual(["The whole answer"]);
  });

  it("throws a readable error for HTTP failures", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    await expect(collect(streamOpenAiChatCompletion(baseConfig, messages))).rejects.toThrow(
      "OpenAI-compatible API error: 401 Unauthorized: Invalid API key",
    );
  });

  it("throws a readable error for network failures", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    );

    await expect(collect(streamOpenAiChatCompletion(baseConfig, messages))).rejects.toThrow(
      "OpenAI-compatible API error: connection refused — is the server running.",
    );
  });

  it("throws a readable error for an invalid Base URL without calling fetch", async () => {
    await expect(
      collect(streamOpenAiChatCompletion({ ...baseConfig, baseUrl: "not a url" }, messages)),
    ).rejects.toThrow('OpenAI-compatible API error: invalid Base URL "not a url".');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a readable error when an SSE error event arrives mid-stream", async () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Partial " } }] })}\n\n`,
      `data: ${JSON.stringify({ error: { message: "insufficient credits", code: 402 } })}\n\n`,
    ];
    fetchMock.mockResolvedValue(sseResponse(chunks));

    const gen = streamOpenAiChatCompletion(baseConfig, messages);
    const first = await gen.next();
    expect(first.value).toBe("Partial ");

    await expect(gen.next()).rejects.toThrow(
      "OpenAI-compatible API error: insufficient credits",
    );
  });
});

describe("testOpenAiConnection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the model from a successful completion", async () => {
    fetchMock.mockResolvedValue(Response.json({ model: "llama3.1:latest" }));

    const result = await testOpenAiConnection(baseConfig);
    expect(result).toEqual({ ok: true, model: "llama3.1:latest" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(false);
  });

  it("falls back to the configured model when the response has none", async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [] }));
    const result = await testOpenAiConnection(baseConfig);
    expect(result).toEqual({ ok: true, model: "llama3.1" });
  });

  it("returns a readable 401 error with 401 status without throwing", async () => {
    fetchMock.mockResolvedValue(
      new Response("", { status: 401, statusText: "Unauthorized" }),
    );
    const result = await testOpenAiConnection(baseConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OpenAI-compatible API error: 401 Unauthorized");
      expect(result.status).toBe(401);
    }
  });

  it("flags missing Base URL or Model before any request", async () => {
    const noUrl = await testOpenAiConnection({ ...baseConfig, baseUrl: "" });
    expect(noUrl).toEqual({ ok: false, error: "OpenAI-compatible API error: no Base URL configured.", status: 400 });

    const noModel = await testOpenAiConnection({ ...baseConfig, model: "" });
    expect(noModel).toEqual({ ok: false, error: "OpenAI-compatible API error: no Model configured.", status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags an invalid Base URL before any request and redacts userinfo", async () => {
    const result = await testOpenAiConnection({
      ...baseConfig,
      baseUrl: "https://secret-token@invalid-url:notaport",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("invalid Base URL");
      expect(result.error).not.toContain("secret-token");
      expect(result.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps connection refused to a readable error with 502 status", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    );
    const result = await testOpenAiConnection(baseConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "OpenAI-compatible API error: connection refused — is the server running.",
      );
      expect(result.status).toBe(502);
    }
  });
});
