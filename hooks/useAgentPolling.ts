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

export interface FailedSessionInfo {
  sessionId: string;
  error: string;
  agentType: string;
}

export function useAgentPolling(projectId: string, intervalMs = 3000, refreshTrigger?: number) {
  const [activities, setActivities] = useState<UnifiedActivity[]>([]);
  const [failedSessions, setFailedSessions] = useState<Record<string, FailedSessionInfo>>({});

  const poll = useCallback(async () => {
    try {
      const [activeRes, allRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/sessions/active`),
        fetch(`/api/projects/${projectId}/sessions`),
      ]);
      const activeData = await activeRes.json();
      setActivities(activeData.data || []);

      const allData = await allRes.json();
      const sessions = allData.data || [];

      // Build a set of epicIds that currently have a running agent
      const runningEpicIds = new Set(
        (activeData.data || [])
          .filter((a: UnifiedActivity) => a.epicId)
          .map((a: UnifiedActivity) => a.epicId)
      );

      // Map by epicId, keeping only the most recent failure per epic
      // (sessions come sorted by createdAt desc from the API)
      const failed: Record<string, FailedSessionInfo> = {};
      for (const session of sessions) {
        if (session.kind !== "agent_session") continue;
        if (session.status !== "failed") continue;
        if (!session.epicId) continue;
        // Skip epics that currently have an active agent
        if (runningEpicIds.has(session.epicId)) continue;
        // Keep only the most recent failure per epic (first seen wins since sorted desc)
        if (!failed[session.epicId]) {
          failed[session.epicId] = {
            sessionId: session.id,
            error: session.error || "Unknown error",
            agentType: session.agentType || "build",
          };
        }
      }
      setFailedSessions(failed);
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

  return { activities, failedSessions, refresh: poll };
}
