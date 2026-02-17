import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useGitStatus } from "@/hooks/useGitStatus";

describe("useGitStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches ahead/behind counts on mount", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { ahead: 3, behind: 1 },
        }),
    });

    const { result } = renderHook(() =>
      useGitStatus("proj-1", "feature/my-branch", true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.ahead).toBe(3);
    expect(result.current.behind).toBe(1);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/proj-1/git/status?branch=feature%2Fmy-branch"
    );
  });

  it("returns zeros when no remote tracking branch exists", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { ahead: 0, behind: 0, noRemote: true },
        }),
    });

    const { result } = renderHook(() =>
      useGitStatus("proj-1", "feature/new-branch", true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.ahead).toBe(0);
    expect(result.current.behind).toBe(0);
  });

  it("handles API error gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({ message: "Git repo not found" }),
    });

    const { result } = renderHook(() =>
      useGitStatus("proj-bad", "main", true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Git repo not found");
    expect(result.current.ahead).toBe(0);
    expect(result.current.behind).toBe(0);
  });

  it("handles network failure gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useGitStatus("proj-1", "main", true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch git status");
  });

  it("push() sends POST and refreshes status on success", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { pushed: true, branch: "feat" } }),
        });
      }
      // GET status — second call returns updated counts
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: callCount <= 1 ? { ahead: 5, behind: 0 } : { ahead: 0, behind: 0 },
          }),
      });
    });

    const { result } = renderHook(() =>
      useGitStatus("proj-1", "feat", true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.ahead).toBe(5);

    await act(async () => {
      await result.current.push();
    });

    expect(result.current.pushing).toBe(false);
  });

  it("push() sets error on failure", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Permission denied" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { ahead: 2, behind: 0 } }),
      });
    });

    const { result } = renderHook(() =>
      useGitStatus("proj-1", "feat", true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.push();
    });

    expect(result.current.error).toBe("Push failed");
  });

  it("does not fetch when githubConfigured is false", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { ahead: 0, behind: 0 } }),
    });

    renderHook(() => useGitStatus("proj-1", "main", false));

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not fetch when branchName is null", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: { ahead: 0, behind: 0 } }),
    });

    renderHook(() => useGitStatus("proj-1", null, true));

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
