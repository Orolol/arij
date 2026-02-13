/**
 * Tests for the GitHub releases service functions.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createDraftRelease,
  publishRelease,
  getRelease,
} from "@/lib/github/releases";

function mockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    repos: {
      createRelease: vi.fn().mockResolvedValue({
        data: {
          id: 100,
          html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          draft: true,
          tag_name: "v1.0.0",
          ...overrides,
        },
      }),
      updateRelease: vi.fn().mockResolvedValue({
        data: {
          id: 100,
          html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          draft: false,
          tag_name: "v1.0.0",
          ...overrides,
        },
      }),
      getRelease: vi.fn().mockResolvedValue({
        data: {
          id: 100,
          html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          draft: true,
          tag_name: "v1.0.0",
          ...overrides,
        },
      }),
    },
  } as unknown as import("@octokit/rest").Octokit;
}

describe("createDraftRelease", () => {
  it("creates a draft release and returns normalized result", async () => {
    const octokit = mockOctokit();
    const result = await createDraftRelease(
      octokit,
      "owner",
      "repo",
      "v1.0.0",
      "Release 1.0.0",
      "## Changes\n- Feature A"
    );

    expect(result).toEqual({
      id: 100,
      htmlUrl: "https://github.com/owner/repo/releases/tag/v1.0.0",
      draft: true,
      tagName: "v1.0.0",
    });

    expect(octokit.repos.createRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      tag_name: "v1.0.0",
      name: "Release 1.0.0",
      body: "## Changes\n- Feature A",
      draft: true,
    });
  });
});

describe("publishRelease", () => {
  it("publishes a draft release", async () => {
    const octokit = mockOctokit();
    const result = await publishRelease(octokit, "owner", "repo", 100);

    expect(result.draft).toBe(false);
    expect(octokit.repos.updateRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      release_id: 100,
      draft: false,
    });
  });
});

describe("getRelease", () => {
  it("gets a release by ID", async () => {
    const octokit = mockOctokit();
    const result = await getRelease(octokit, "owner", "repo", 100);

    expect(result.id).toBe(100);
    expect(result.draft).toBe(true);
    expect(octokit.repos.getRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      release_id: 100,
    });
  });
});
