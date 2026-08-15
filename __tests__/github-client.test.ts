/**
 * Tests for the GitHub client module: token retrieval and owner/repo parsing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Real @/lib/db/schema (side-effect-free); only the db module is mocked.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

/**
 * Re-mocks @/lib/db so every `.get()` returns `row` (the settings lookup is
 * read once per call, so a constant beats a queue here).
 */
function doMockSettingsRow(row: unknown) {
  vi.doMock("@/lib/db", async () => {
    const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
    const mod = dbModuleMock();
    mod.db.get.mockImplementation(() => row);
    return mod;
  });
}

describe("parseOwnerRepo", () => {
  it("parses valid owner/repo string", async () => {
    const { parseOwnerRepo } = await import("@/lib/github/client");
    const result = parseOwnerRepo("octocat/hello-world");
    expect(result).toEqual({ owner: "octocat", repo: "hello-world" });
  });

  it("throws on invalid format - no slash", async () => {
    const { parseOwnerRepo } = await import("@/lib/github/client");
    expect(() => parseOwnerRepo("invalid")).toThrow("Invalid GitHub owner/repo format");
  });

  it("throws on invalid format - too many slashes", async () => {
    const { parseOwnerRepo } = await import("@/lib/github/client");
    expect(() => parseOwnerRepo("a/b/c")).toThrow("Invalid GitHub owner/repo format");
  });

  it("throws on empty owner", async () => {
    const { parseOwnerRepo } = await import("@/lib/github/client");
    expect(() => parseOwnerRepo("/repo")).toThrow("Invalid GitHub owner/repo format");
  });

  it("throws on empty repo", async () => {
    const { parseOwnerRepo } = await import("@/lib/github/client");
    expect(() => parseOwnerRepo("owner/")).toThrow("Invalid GitHub owner/repo format");
  });
});

describe("getGitHubTokenFromSettings", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns null when no setting exists", async () => {
    doMockSettingsRow(null);

    const { getGitHubTokenFromSettings } = await import("@/lib/github/client");
    expect(getGitHubTokenFromSettings()).toBeNull();
  });

  it("returns token when setting exists with valid value", async () => {
    doMockSettingsRow({
      key: "github_pat",
      value: JSON.stringify("ghp_abc123"),
    });

    const { getGitHubTokenFromSettings } = await import("@/lib/github/client");
    expect(getGitHubTokenFromSettings()).toBe("ghp_abc123");
  });

  it("returns null for empty string token", async () => {
    doMockSettingsRow({
      key: "github_pat",
      value: JSON.stringify(""),
    });

    const { getGitHubTokenFromSettings } = await import("@/lib/github/client");
    expect(getGitHubTokenFromSettings()).toBeNull();
  });
});

describe("createOctokit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws when no token is configured", async () => {
    doMockSettingsRow(null);

    const { createOctokit } = await import("@/lib/github/client");
    expect(() => createOctokit()).toThrow("GitHub PAT not configured");
  });

  it("returns Octokit instance when token is configured", async () => {
    doMockSettingsRow({
      key: "github_pat",
      value: JSON.stringify("ghp_testtoken"),
    });

    const { createOctokit } = await import("@/lib/github/client");
    const octokit = createOctokit();
    expect(octokit).toBeDefined();
  });
});
