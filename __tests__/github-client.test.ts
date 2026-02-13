/**
 * Tests for the GitHub client module: token retrieval and owner/repo parsing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => null),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  settings: {},
}));

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

describe("getGitHubToken", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns null when no setting exists", async () => {
    vi.doMock("@/lib/db", () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn(() => null),
      };
      return { db: chain };
    });

    const { getGitHubToken } = await import("@/lib/github/client");
    expect(getGitHubToken()).toBeNull();
  });

  it("returns token when setting exists with valid value", async () => {
    vi.doMock("@/lib/db", () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn(() => ({
          key: "github_pat",
          value: JSON.stringify("ghp_abc123"),
        })),
      };
      return { db: chain };
    });

    const { getGitHubToken } = await import("@/lib/github/client");
    expect(getGitHubToken()).toBe("ghp_abc123");
  });

  it("returns null for empty string token", async () => {
    vi.doMock("@/lib/db", () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn(() => ({
          key: "github_pat",
          value: JSON.stringify(""),
        })),
      };
      return { db: chain };
    });

    const { getGitHubToken } = await import("@/lib/github/client");
    expect(getGitHubToken()).toBeNull();
  });
});

describe("createOctokit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws when no token is configured", async () => {
    vi.doMock("@/lib/db", () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn(() => null),
      };
      return { db: chain };
    });

    const { createOctokit } = await import("@/lib/github/client");
    expect(() => createOctokit()).toThrow("GitHub PAT not configured");
  });

  it("returns Octokit instance when token is configured", async () => {
    vi.doMock("@/lib/db", () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn(() => ({
          key: "github_pat",
          value: JSON.stringify("ghp_testtoken"),
        })),
      };
      return { db: chain };
    });

    const { createOctokit } = await import("@/lib/github/client");
    const octokit = createOctokit();
    expect(octokit).toBeDefined();
  });
});
