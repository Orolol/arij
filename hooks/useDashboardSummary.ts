"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/hooks/usePolling";

/** One live agent session, cross-project (GET /api/dashboard/summary). */
export interface DashboardRunningSession {
  sessionId: string;
  projectId: string;
  projectName: string | null;
  epicId: string | null;
  epicReadableId: string | null;
  provider: string | null;
  agentType: string | null;
  startedAt: string | null;
}

export interface DashboardSummary {
  runningSessions: DashboardRunningSession[];
  /** Night runs started in the last 24h: distinct projects and their cost. */
  nightRunsLastNight: { projects: number; totalCostUsd: number };
  /** Terminal agent sessions in the last 24h — completed vs failed. */
  yesterday: { completed: number; failed: number };
}

const POLL_INTERVAL_MS = 10000;

const EMPTY: DashboardSummary = {
  runningSessions: [],
  nightRunsLastNight: { projects: 0, totalCostUsd: 0 },
  yesterday: { completed: 0, failed: 0 },
};

/**
 * Ambient cross-project aggregate behind the dashboard band. Best-effort
 * like the other pollers: a failed request keeps the previous snapshot
 * rather than blanking the numbers.
 */
export function useDashboardSummary(): DashboardSummary & { loading: boolean } {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/summary");
      const json = await res.json();
      if (json?.data) {
        setSummary({
          runningSessions: Array.isArray(json.data.runningSessions)
            ? json.data.runningSessions
            : [],
          nightRunsLastNight: {
            projects: Number(json.data.nightRunsLastNight?.projects ?? 0),
            totalCostUsd: Number(json.data.nightRunsLastNight?.totalCostUsd ?? 0),
          },
          yesterday: {
            completed: Number(json.data.yesterday?.completed ?? 0),
            failed: Number(json.data.yesterday?.failed ?? 0),
          },
        });
      }
    } catch {
      // ignore — the band is informational
    }
    setLoading(false);
  }, []);

  usePolling(load, POLL_INTERVAL_MS);

  return { ...summary, loading };
}
