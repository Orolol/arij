import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";

describe("useGitHubConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns isConfigured=true when ownerRepo and token are set", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/projects/")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({ data: { githubOwnerRepo: "owner/repo" } }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ data: { github_pat: "ghp_token123" } }),
      });
    });

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isConfigured).toBe(true);
    expect(result.current.ownerRepo).toBe("owner/repo");
    expect(result.current.tokenSet).toBe(true);
  });

  it("returns isConfigured=false when ownerRepo is missing", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/projects/")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({ data: { githubOwnerRepo: null } }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ data: { github_pat: "ghp_token123" } }),
      });
    });

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isConfigured).toBe(false);
    expect(result.current.ownerRepo).toBeNull();
  });

  it("returns isConfigured=false when token is not set", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/projects/")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({ data: { githubOwnerRepo: "owner/repo" } }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ data: { github_pat: "" } }),
      });
    });

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isConfigured).toBe(false);
    expect(result.current.tokenSet).toBe(false);
  });

  it("handles API errors gracefully", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/projects/")) {
        return Promise.resolve({
          json: () => Promise.resolve({ error: "Project not found" }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ data: { github_pat: "ghp_token123" } }),
      });
    });

    const { result } = renderHook(() => useGitHubConfig("proj-bad"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isConfigured).toBe(false);
  });

  it("handles fetch failure gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isConfigured).toBe(false);
  });

  it("starts in loading state", () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/projects/")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({ data: { githubOwnerRepo: null } }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ data: { github_pat: "" } }),
      });
    });

    const { result } = renderHook(() => useGitHubConfig("proj-1"));
    expect(result.current.loading).toBe(true);
  });

  it("does not fetch when projectId is undefined", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/projects/")) {
        return Promise.resolve({
          json: () => Promise.resolve({ data: {} }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ data: {} }),
      });
    });

    renderHook(() => useGitHubConfig(undefined));

    // Give it a tick to potentially fire
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
