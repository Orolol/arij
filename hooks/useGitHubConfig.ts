"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface GitHubConfigData {
  configured: boolean;
  ownerRepo: string | null;
  tokenSet: boolean;
}

interface UseGitHubConfigResult {
  configured: boolean;
  ownerRepo: string | null;
  tokenSet: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Hook to check whether GitHub is configured for a project.
 * Returns configuration status, owner/repo string, and whether a PAT is set.
 */
export function useGitHubConfig(projectId: string | null): UseGitHubConfigResult {
  const [data, setData] = useState<GitHubConfigData>({
    configured: false,
    ownerRepo: null,
    tokenSet: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const fetchConfig = useCallback(async () => {
    if (!projectId || fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const res = await fetch(`/api/projects/${projectId}/git/config`);
      const json = await res.json();

      if (json.error) {
        setError(json.error);
        setData({ configured: false, ownerRepo: null, tokenSet: false });
      } else {
        setData({
          configured: json.data.configured ?? false,
          ownerRepo: json.data.ownerRepo ?? null,
          tokenSet: json.data.tokenSet ?? false,
        });
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch GitHub config");
      setData({ configured: false, ownerRepo: null, tokenSet: false });
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    fetchConfig();
  }, [fetchConfig]);

  const refresh = useCallback(() => {
    fetchConfig();
  }, [fetchConfig]);

  return {
    ...data,
    loading,
    error,
    refresh,
  };
}
