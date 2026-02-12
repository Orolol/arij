"use client";

import { useState, useEffect } from "react";

interface GitHubConfig {
  configured: boolean;
  loading: boolean;
  githubOwnerRepo: string | null;
  hasToken: boolean;
}

/**
 * Hook to check if GitHub is configured for PR workflows.
 * Checks both the project's githubOwnerRepo and the global GitHub PAT setting.
 */
export function useGitHubConfig(projectId: string): GitHubConfig {
  const [config, setConfig] = useState<GitHubConfig>({
    configured: false,
    loading: true,
    githubOwnerRepo: null,
    hasToken: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const [projectRes, settingsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}`),
          fetch("/api/settings"),
        ]);

        const projectData = await projectRes.json();
        const settingsData = await settingsRes.json();

        if (cancelled) return;

        const githubOwnerRepo = projectData.data?.githubOwnerRepo || null;
        const hasToken = Boolean(settingsData.data?.githubPat);

        setConfig({
          configured: Boolean(githubOwnerRepo && hasToken),
          loading: false,
          githubOwnerRepo,
          hasToken,
        });
      } catch {
        if (!cancelled) {
          setConfig({
            configured: false,
            loading: false,
            githubOwnerRepo: null,
            hasToken: false,
          });
        }
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return config;
}
