"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface GitStatusData {
  ahead: number;
  behind: number;
  noRemote?: boolean;
}

interface UseGitStatusResult {
  ahead: number;
  behind: number;
  noRemote: boolean;
  loading: boolean;
  pushing: boolean;
  error: string | null;
  push: () => Promise<{ success: boolean; error?: string }>;
  refresh: () => void;
}

/**
 * Hook to fetch ahead/behind counts for a branch and provide push functionality.
 * Debounces duplicate requests using a ref guard.
 */
export function useGitStatus(
  projectId: string | null,
  branchName: string | null
): UseGitStatusResult {
  const [data, setData] = useState<GitStatusData>({ ahead: 0, behind: 0 });
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!projectId || !branchName || fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/git/status?branch=${encodeURIComponent(branchName)}`
      );
      const json = await res.json();

      if (json.error) {
        setError(json.error);
        setData({ ahead: 0, behind: 0 });
      } else {
        setData({
          ahead: json.data.ahead ?? 0,
          behind: json.data.behind ?? 0,
          noRemote: json.data.noRemote ?? false,
        });
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch git status");
      setData({ ahead: 0, behind: 0 });
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [projectId, branchName]);

  useEffect(() => {
    if (projectId && branchName) {
      fetchStatus();
    }
  }, [fetchStatus, projectId, branchName]);

  const push = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!projectId || !branchName) {
      return { success: false, error: "Missing project or branch" };
    }

    setPushing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/git/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: branchName }),
      });
      const json = await res.json();

      if (json.error) {
        setError(json.error);
        return { success: false, error: json.error };
      }

      // Refresh status after successful push
      setError(null);
      await fetchStatus();
      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Push failed";
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setPushing(false);
    }
  }, [projectId, branchName, fetchStatus]);

  const refresh = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    ahead: data.ahead,
    behind: data.behind,
    noRemote: data.noRemote ?? false,
    loading,
    pushing,
    error,
    push,
    refresh,
  };
}
