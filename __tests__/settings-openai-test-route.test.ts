import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

/**
 * Seeds the settings rows `getOpenAiConfigFromSettings()` reads, in the
 * exact key order the client queries them (base url, api key, model,
 * reasoning effort).
 */
function seedConfig(overrides: Record<string, string> = {}) {
  const values = {
    openai_base_url: "http://localhost:11434/v1",
    openai_api_key: "sk-test",
    openai_model: "llama3.1",
    openai_reasoning_effort: "off",
    ...overrides,
  };
  dbMockState.getQueue = [
    { key: "openai_base_url", value: JSON.stringify(values.openai_base_url) },
    { key: "openai_api_key", value: JSON.stringify(values.openai_api_key) },
    { key: "openai_model", value: JSON.stringify(values.openai_model) },
    { key: "openai_reasoning_effort", value: JSON.stringify(values.openai_reasoning_effort) },
  ];
}

describe("POST /api/settings/openai/test", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns 200 with the model on a successful completion", async () => {
    seedConfig();
    fetchMock.mockResolvedValue(Response.json({ model: "llama3.1:latest" }));

    const { POST } = await import("@/app/api/settings/openai/test/route");
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ data: { valid: true, model: "llama3.1:latest" } });

    // The request is a minimal non-streaming completion against the saved
    // endpoint, and the key never appears in the response.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(false);
    expect(body.model).toBe("llama3.1");
    expect(JSON.stringify(json)).not.toContain("sk-test");
  });

  it("returns 400 with a readable error for an unauthorized endpoint", async () => {
    seedConfig();
    fetchMock.mockResolvedValue(
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );

    const { POST } = await import("@/app/api/settings/openai/test/route");
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("OpenAI-compatible API error: 401 Unauthorized: nope");
  });

  it("returns 400 with a readable error when the server is unreachable", async () => {
    seedConfig();
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    );

    const { POST } = await import("@/app/api/settings/openai/test/route");
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(
      "OpenAI-compatible API error: connection refused — is the server running.",
    );
  });

  it("returns 400 without calling fetch when the endpoint is not configured", async () => {
    // No settings rows at all -> every read is empty.
    const { POST } = await import("@/app/api/settings/openai/test/route");
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("OpenAI-compatible API error: no Base URL configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 without calling fetch for an invalid Base URL", async () => {
    seedConfig({ openai_base_url: "not a url" });

    const { POST } = await import("@/app/api/settings/openai/test/route");
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("invalid Base URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
