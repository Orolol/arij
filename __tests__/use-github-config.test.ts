import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";

/**
 * `GET /api/settings` never returns the PAT itself: it masks `github_pat`
 * down to `{ hasToken: boolean }` (app/api/settings/route.ts). These tests
 * mock that masked shape — the only shape the hook can actually observe —
 * so a hook reading the key as a raw string reports "not configured" here
 * exactly as it did in the product.
 */
function mockSettings(githubPat: unknown, ownerRepo: string | null = "owner/repo") {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/projects") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "proj-1", githubOwnerRepo: ownerRepo }, { id: "p", githubOwnerRepo: ownerRepo }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { tokenSet: typeof githubPat === "object" && githubPat !== null && "hasToken" in githubPat && githubPat.hasToken === true },
        }),
    });
  });
}

describe("useGitHubConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("treats the masked { hasToken: true } payload as a configured token", async () => {
    mockSettings({ hasToken: true });

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tokenSet).toBe(true);
    expect(result.current.isConfigured).toBe(true);
    expect(result.current.ownerRepo).toBe("owner/repo");
  });

  it("treats the masked { hasToken: false } payload as no token", async () => {
    mockSettings({ hasToken: false });

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tokenSet).toBe(false);
    expect(result.current.isConfigured).toBe(false);
  });

  it("treats an absent github_pat key as no token", async () => {
    mockSettings(undefined);

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tokenSet).toBe(false);
    expect(result.current.isConfigured).toBe(false);
  });

  it("does not accept a bare string as a token (the API always masks)", async () => {
    mockSettings("ghp_token123");

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tokenSet).toBe(false);
    expect(result.current.isConfigured).toBe(false);
  });

  it("returns isConfigured=false when ownerRepo is missing but a token is set", async () => {
    mockSettings({ hasToken: true }, null);

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tokenSet).toBe(true);
    expect(result.current.isConfigured).toBe(false);
    expect(result.current.ownerRepo).toBeNull();
  });

  it("handles API errors gracefully", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: "Project not found" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { tokenSet: true } }),
      });
    });

    const { result } = renderHook(() => useGitHubConfig("proj-bad"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isConfigured).toBe(false);
    expect(result.current.ownerRepo).toBeNull();
  });

  it("handles fetch failure gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useGitHubConfig("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isConfigured).toBe(false);
    expect(result.current.tokenSet).toBe(false);
  });

  it("starts in loading state", () => {
    mockSettings({ hasToken: false }, null);

    const { result } = renderHook(() => useGitHubConfig("proj-1"));
    expect(result.current.loading).toBe(true);
  });

  it("does not fetch when projectId is undefined", async () => {
    mockSettings({ hasToken: true });

    renderHook(() => useGitHubConfig(undefined));

    // Give it a tick to potentially fire
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("clears a previously configured project immediately when the project is removed", async () => {
    mockSettings({ hasToken: true });
    const view = renderHook(({ id }: { id?: string }) => useGitHubConfig(id), { initialProps: { id: "p" } as { id?: string } });
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    view.rerender({ id: undefined });
    expect(view.result.current.isConfigured).toBe(false);
    expect(view.result.current.ownerRepo).toBeNull();
    expect(view.result.current.loading).toBe(false);
  });

  it("exposes an HTTP failure as unknown configuration even when the body resembles settings", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { githubOwnerRepo: "o/r", tokenSet: true } }), { status: 503 }));
    const { result } = renderHook(() => useGitHubConfig("p"));
    await act(async () => {});
    expect(result.current.error).toBe(true);
    expect(result.current.isConfigured).toBe(false);
  });
});
