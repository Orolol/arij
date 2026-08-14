"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Generate-spec fetch flow for a project: POSTs to the generate-spec endpoint
 * with the given provider, tracks in-flight/error state, and refreshes the
 * router on success.
 */
export function useSpecGeneration(projectId: string, provider: string) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSpec = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/generate-spec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || `Spec generation failed (HTTP ${res.status})`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spec generation request failed");
    }
    setGenerating(false);
  }, [projectId, provider, router]);

  return { generateSpec, generating, error };
}
