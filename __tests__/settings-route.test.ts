import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
} from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

describe("Settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("GET redacts github_pat while preserving hasToken", async () => {
    dbMockState.allRows = [
      { key: "global_prompt", value: JSON.stringify("Always write tests") },
      { key: "github_pat", value: JSON.stringify("ghp_super_secret") },
    ];

    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.global_prompt).toBe("Always write tests");
    expect(json.data.github_pat).toEqual({ hasToken: true });
    expect(JSON.stringify(json)).not.toContain("ghp_super_secret");
  });

  it("GET shows hasToken false when PAT is blank", async () => {
    dbMockState.allRows = [
      { key: "github_pat", value: JSON.stringify("") },
    ];

    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const json = await res.json();

    expect(json.data.github_pat).toEqual({ hasToken: false });
  });

  it("PATCH rejects non-string github_pat values with actionable error", async () => {
    const { PATCH } = await import("@/app/api/settings/route");

    const res = await PATCH(
      mockJsonRequest({ github_pat: { token: "ghp_bad" } })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("GitHub token must be saved as a string value.");
  });

  it("PATCH persists github_pat string value", async () => {
    dbMockState.getQueue = [null];
    const { PATCH } = await import("@/app/api/settings/route");

    const res = await PATCH(
      mockJsonRequest({ github_pat: "ghp_123" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.updated).toBe(true);
    expect(dbMockState.insertCalls).toContainEqual(
      expect.objectContaining({
        key: "github_pat",
        value: JSON.stringify("ghp_123"),
      })
    );
  });

  it("GET masks openai_api_key as hasToken without leaking the key", async () => {
    dbMockState.allRows = [
      { key: "openai_base_url", value: JSON.stringify("http://localhost:11434/v1") },
      { key: "openai_api_key", value: JSON.stringify("sk-super-secret") },
      { key: "openai_model", value: JSON.stringify("gpt-4o-mini") },
      { key: "openai_reasoning_effort", value: JSON.stringify("medium") },
    ];

    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.openai_api_key).toEqual({ hasToken: true });
    expect(json.data.openai_base_url).toBe("http://localhost:11434/v1");
    expect(json.data.openai_model).toBe("gpt-4o-mini");
    expect(json.data.openai_reasoning_effort).toBe("medium");
    expect(JSON.stringify(json)).not.toContain("sk-super-secret");
  });

  it("GET reports hasToken false when the OpenAI key is empty", async () => {
    dbMockState.allRows = [
      { key: "openai_api_key", value: JSON.stringify("") },
    ];

    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const json = await res.json();

    expect(json.data.openai_api_key).toEqual({ hasToken: false });
  });

  it("PATCH persists an openai_api_key string value", async () => {
    dbMockState.getQueue = [null]; // no existing row -> insert path

    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(mockJsonRequest({ openai_api_key: "sk-123" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.updated).toBe(true);
    expect(dbMockState.insertCalls).toContainEqual(
      expect.objectContaining({
        key: "openai_api_key",
        value: JSON.stringify("sk-123"),
      })
    );
  });

  it("PATCH rejects non-string openai_api_key values", async () => {
    const { PATCH } = await import("@/app/api/settings/route");
    const res = await PATCH(
      mockJsonRequest({ openai_api_key: { token: "sk-bad" } })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("OpenAI API key must be saved as a string value.");
  });
});
