/**
 * Tests for the GitHub releases service functions.
 */
import { describe, it, expect, vi } from "vitest";

const mockCreateRelease = vi.fn();
const mockUpdateRelease = vi.fn();
const mockGetReleaseApi = vi.fn();

vi.mock("@/lib/github/client", () => ({
  getGitHubTokenFromSettings: vi.fn(() => "ghp_test_token"),
  createGitHubClient: vi.fn(() => ({
    rest: {
      repos: {
        createRelease: mockCreateRelease,
        updateRelease: mockUpdateRelease,
        getRelease: mockGetReleaseApi,
      },
    },
  })),
}));

import {
  createDraftRelease,
  publishRelease,
  getRelease,
} from "@/lib/github/releases";

describe("createDraftRelease", () => {
  it("creates a draft release and returns normalized result", async () => {
    mockCreateRelease.mockResolvedValue({
      data: {
        id: 100,
        html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
        draft: true,
        tag_name: "v1.0.0",
      },
    });

    const result = await createDraftRelease({
      owner: "owner",
      repo: "repo",
      tag: "v1.0.0",
      title: "Release 1.0.0",
      body: "## Changes\n- Feature A",
    });

    expect(result).toEqual({
      id: 100,
      htmlUrl: "https://github.com/owner/repo/releases/tag/v1.0.0",
      url: "https://github.com/owner/repo/releases/tag/v1.0.0",
      draft: true,
      tagName: "v1.0.0",
    });

    expect(mockCreateRelease).toHaveBeenCalledWith({
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
    mockUpdateRelease.mockResolvedValue({
      data: {
        id: 100,
        html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
        draft: false,
        tag_name: "v1.0.0",
      },
    });

    const result = await publishRelease({ owner: "owner", repo: "repo", releaseId: 100 });

    expect(result.draft).toBe(false);
    expect(mockUpdateRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      release_id: 100,
      draft: false,
    });
  });
});

describe("getRelease", () => {
  it("gets a release by ID", async () => {
    mockGetReleaseApi.mockResolvedValue({
      data: {
        id: 100,
        html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
        draft: true,
        tag_name: "v1.0.0",
      },
    });

    const result = await getRelease({ owner: "owner", repo: "repo", releaseId: 100 });

    expect(result.id).toBe(100);
    expect(result.draft).toBe(true);
    expect(mockGetReleaseApi).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      release_id: 100,
    });
  });
});
