import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/github/client", () => ({
  GITHUB_PAT_SETTING_KEY: "github_pat",
}));

describe("GET /api/settings - GitHub PAT redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("redacts github_pat value, returning hasToken indicator", async () => {
    dbMockState.allQueue = [
      [
        {
          key: "github_pat",
          value: JSON.stringify("ghp_abcdefghijklmnopqrstuvwxyz1234"),
        },
        { key: "global_prompt", value: JSON.stringify("Hello world") },
      ],
    ];

    const { GET } = await import("@/app/api/settings/route");
    const response = await GET();
    const json = await response.json();

    // The API returns { hasToken: true } instead of the raw token
    expect(json.data.github_pat).toEqual({ hasToken: true });
    // Ensure the raw token is not present in the response
    expect(JSON.stringify(json.data)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("does not touch other settings", async () => {
    dbMockState.allQueue = [
      [
        {
          key: "global_prompt",
          value: JSON.stringify("My custom prompt"),
        },
      ],
    ];

    const { GET } = await import("@/app/api/settings/route");
    const response = await GET();
    const json = await response.json();

    expect(json.data.global_prompt).toBe("My custom prompt");
  });

  it("handles short tokens gracefully", async () => {
    dbMockState.allQueue = [
      [
        {
          key: "github_pat",
          value: JSON.stringify("short"),
        },
      ],
    ];

    const { GET } = await import("@/app/api/settings/route");
    const response = await GET();
    const json = await response.json();

    // Short tokens also return { hasToken: true }
    expect(json.data.github_pat).toEqual({ hasToken: true });
  });
});
