"use client";

import { useState, useCallback } from "react";

interface PrState {
  prNumber: number | null;
  prUrl: string | null;
  prStatus: string | null;
}

interface UseEpicPrReturn {
  creating: boolean;
  syncing: boolean;
  error: string | null;
  hint: string | null;
  createPr: () => Promise<PrState | null>;
  syncPrStatus: () => Promise<PrState | null>;
}

/**
 * Hook to manage PR creation and status sync for an epic.
 */
export function useEpicPr(
  projectId: string,
  epicId: string | null
): UseEpicPrReturn {
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const createPr = useCallback(async (): Promise<PrState | null> => {
    if (!epicId) return null;
    setCreating(true);
    setError(null);
    setHint(null);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/epics/${epicId}/pr`,
        { method: "POST" }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create PR");
        setHint(data.hint || null);
        return null;
      }

      return {
        prNumber: data.data.prNumber,
        prUrl: data.data.prUrl,
        prStatus: data.data.prStatus,
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create PR");
      return null;
    } finally {
      setCreating(false);
    }
  }, [projectId, epicId]);

  const syncPrStatus = useCallback(async (): Promise<PrState | null> => {
    if (!epicId) return null;
    setSyncing(true);
    setError(null);
    setHint(null);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/epics/${epicId}/pr`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to sync PR status");
        setHint(data.hint || null);
        return null;
      }

      return {
        prNumber: data.data.prNumber,
        prUrl: data.data.prUrl,
        prStatus: data.data.prStatus,
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sync PR status");
      return null;
    } finally {
      setSyncing(false);
    }
  }, [projectId, epicId]);

  return {
    creating,
    syncing,
    error,
    hint,
    createPr,
    syncPrStatus,
  };
}
