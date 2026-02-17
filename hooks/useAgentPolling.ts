"use client";

import { useState, useEffect, useCallback } from "react";

export interface UnifiedActivity {
  id: string;
  epicId?: string | null;
  userStoryId?: string | null;
  type: "build" | "review" | "merge" | "chat" | "spec_generation" | "release";
  label: string;
  status: string;
  mode: string;
  provider: string;
  namedAgentName?: string | null;
  startedAt: string;
  source: "db" | "registry";
  cancellable: boolean;
}

export function useAgentPolling(projectId: string, intervalMs = 3000, refreshTrigger?: number) {
  const [activities, setActivities] = useState<UnifiedActivity[]>([]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/sessions/active`);
      const data = await res.json();
      setActivities(data.data || []);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [poll, intervalMs]);

  // Immediate re-poll when SSE triggers a refresh
  useEffect(() => {
    if (refreshTrigger) poll();
  }, [refreshTrigger, poll]);

  return { activities, refresh: poll };
}
