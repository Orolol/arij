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
});
