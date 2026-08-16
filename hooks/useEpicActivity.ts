"use client";

import { useState, useEffect, useCallback } from "react";
import { usePolling } from "@/hooks/usePolling";

/** One kanban transition from the ticket activity log (newest first from the API). */
export interface EpicActivityEntry {
  id: string;
  projectId: string;
  epicId: string;
  fromStatus: string;
  toStatus: string;
  actor: "user" | "agent" | "system";
  reason: string | null;
  sessionId: string | null;
  createdAt: string | null;
}

/**
 * Loads and polls (5s) the transition activity log of an epic.
 *
 * Mirrors `useTicketComments`' shape. `enabled` gates the polling so callers
 * only poll while the Activity tab is actually visible; a null epicId
 * resolves to an empty, non-polling feed.
 */
export function useEpicActivity(
  projectId: string,
  epicId: string | null,
  enabled: boolean = true
) {
  const activityUrl = epicId
    ? `/api/projects/${projectId}/epics/${epicId}/activity`
    : null;

  const [entries, setEntries] = useState<EpicActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    if (!activityUrl) return;
    try {
      const res = await fetch(activityUrl);
      const data = await res.json();
      if (data.data) {
        setEntries(data.data);
      }
    } catch {
      // silently fail on poll
    }
    setLoading(false);
  }, [activityUrl]);

  // Reset to an empty, non-loading feed when there is no target URL
  useEffect(() => {
    if (!activityUrl) {
      setEntries([]);
      setLoading(false);
    }
  }, [activityUrl]);

  // Initial load + 5s polling while visible
  usePolling(loadActivity, 5000, !!activityUrl && enabled);

  return { entries, loading, refresh: loadActivity };
}
