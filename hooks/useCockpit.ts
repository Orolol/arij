"use client";

import { useCallback, useMemo, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { useInbox, type InboxItem } from "@/hooks/useInbox";
import { useNightRunDetail, useNightRuns } from "@/hooks/useNightRuns";
import type { UnifiedActivity } from "@/hooks/useAgentPolling";

/** Night-run slice of the cockpit: the live run, or the most recent one. */
export interface CockpitNightRun {
  runId: string;
  state: "running" | "finished";
  /** From NightRunDetail; null until the detail poll lands. */
  currentWave: number | null;
  totalWaves: number | null;
  totalEpics: number;
  totalCostUsd: number;
  costIsPartial: boolean;
  interrupted: boolean;
  /** NightRunDetail["counts"] — drives the finished-run fallback line. */
  counts: Record<string, number>;
}

export interface CockpitData {
  /** Active run, else the most recent finished run, else null. */
  nightRun: CockpitNightRun | null;
  /** Sessions the server reports as actually running right now. */
  runningSessions: UnifiedActivity[];
  /** This project's inbox items that are waiting on a human answer. */
  awaitingReply: InboxItem[];
  /** Terminal agent sessions in the last 24h — no "merged" claim. */
  yesterday: { completed: number; failed: number };
}

const ACTIVE_SESSIONS_POLL_MS = 5000;
const YESTERDAY_POLL_MS = 60000;
const NIGHT_RUNS_POLL_MS = 15000;
const DAY_MS = 86_400_000;

/**
 * SQLite `CURRENT_TIMESTAMP` writes "YYYY-MM-DD HH:MM:SS" (UTC, no zone
 * marker) while the lifecycle writes ISO strings with a `T` and a zone.
 * `Date.parse` reads the former as *local* time, which would shift the 24h
 * window by the machine's offset — normalise it to UTC before parsing.
 */
function parseSessionTime(value: string | null | undefined): number {
  if (!value) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return Date.parse(normalized);
}

interface SessionRow {
  kind?: string;
  status?: string;
  endedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
}

/**
 * Derived, never stored: everything the cockpit band shows for one project,
 * composed from the hooks/routes that already exist. Deliberately does NOT
 * reuse `useAgentPolling` — that hook polls every 3s for the board, and the
 * ambient band does not need to double that traffic.
 */
export function useCockpit(projectId: string): CockpitData & { loading: boolean } {
  const { runs, activeRun, loading: runsLoading } = useNightRuns(
    projectId,
    true,
    NIGHT_RUNS_POLL_MS
  );
  const selectedRun = activeRun ?? runs[0] ?? null;
  const { detail } = useNightRunDetail(projectId, selectedRun?.runId ?? null);

  const [runningSessions, setRunningSessions] = useState<UnifiedActivity[]>([]);
  const loadActiveSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/sessions/active`);
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        setRunningSessions(
          (json.data as UnifiedActivity[]).filter((a) => a.status === "running")
        );
      }
    } catch {
      // Ambient band — keep the previous snapshot rather than blanking it.
    }
  }, [projectId]);
  usePolling(loadActiveSessions, ACTIVE_SESSIONS_POLL_MS);

  const [yesterday, setYesterday] = useState({ completed: 0, failed: 0 });
  const loadYesterday = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/sessions`);
      const json = await res.json();
      if (!Array.isArray(json?.data)) return;
      const cutoff = Date.now() - DAY_MS;
      let completed = 0;
      let failed = 0;
      for (const row of json.data as SessionRow[]) {
        if (row.kind !== "agent_session") continue;
        if (row.status !== "completed" && row.status !== "failed") continue;
        const at = parseSessionTime(row.endedAt ?? row.completedAt ?? row.createdAt);
        if (!Number.isFinite(at) || at < cutoff) continue;
        if (row.status === "completed") completed += 1;
        else failed += 1;
      }
      setYesterday({ completed, failed });
    } catch {
      // ignore — informational counters
    }
  }, [projectId]);
  usePolling(loadYesterday, YESTERDAY_POLL_MS);

  const { items, loading: inboxLoading } = useInbox();
  const awaitingReply = useMemo(
    () => items.filter((i) => i.projectId === projectId && i.awaitingReply),
    [items, projectId]
  );

  const nightRun = useMemo<CockpitNightRun | null>(() => {
    if (!selectedRun) return null;
    const fromDetail = detail && detail.runId === selectedRun.runId ? detail : null;
    return {
      runId: selectedRun.runId,
      state: selectedRun.state,
      currentWave: fromDetail?.currentWave ?? null,
      totalWaves: fromDetail?.totalWaves ?? null,
      totalEpics: fromDetail?.epics.length ?? 0,
      totalCostUsd: fromDetail?.totalCostUsd ?? selectedRun.totalCostUsd,
      costIsPartial: fromDetail?.costIsPartial ?? false,
      interrupted: fromDetail?.interrupted ?? selectedRun.interrupted,
      counts: fromDetail?.counts ?? selectedRun.counts,
    };
  }, [selectedRun, detail]);

  return {
    nightRun,
    runningSessions,
    awaitingReply,
    yesterday,
    loading: runsLoading || inboxLoading,
  };
}
