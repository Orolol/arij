"use client";
import { useEffect, useRef } from "react";
import { usePolledResource } from "@/hooks/usePolledResource";
import type { UnifiedActivity } from "@/lib/agent-sessions/active-activity";
const NO_ACTIVITIES: UnifiedActivity[] = [];
const loadError = () => "Unable to load active sessions";
const isActivities = (value: unknown): value is UnifiedActivity[] => Array.isArray(value);
export function useAgentPolling(projectId: string, intervalMs = 3000, refreshTrigger?: number) {
  const { data, error, refresh } = usePolledResource<UnifiedActivity[]>(projectId ? `/api/projects/${projectId}/sessions/active` : null, intervalMs, loadError, { validateData: isActivities, cancelPrevious: true });
  const previousTrigger = useRef(refreshTrigger);
  useEffect(() => {
    if (previousTrigger.current === refreshTrigger) return;
    previousTrigger.current = refreshTrigger;
    void refresh();
  }, [refreshTrigger, refresh]);
  return { activities: data ?? NO_ACTIVITIES, error, refresh };
}
