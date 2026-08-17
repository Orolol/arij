"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import type {
  NightRunDetail,
  NightRunListEntry,
} from "@/lib/night/constants";

/**
 * Polls the project's night runs (the registry's active run plus its recent
 * ring, merged with restart-interrupted runs rebuilt from the database).
 *
 * Best-effort like the other monitor pollers: a failed request keeps the
 * previous snapshot rather than blanking the UI.
 */
export function useNightRuns(
  projectId: string,
  enabled: boolean = true,
  intervalMs: number = 5000
) {
  const [runs, setRuns] = useState<NightRunListEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/build/night-runs`);
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        setRuns(json.data as NightRunListEntry[]);
      }
    } catch {
      // ignore — the list is informational
    }
    setLoading(false);
  }, [projectId]);

  usePolling(load, intervalMs, enabled);

  /**
   * The one run currently executing. A run rebuilt from the database after a
   * restart is never "active": its engine died with the process.
   */
  const activeRun = useMemo(
    () =>
      runs.find((run) => run.state === "running" && !run.interrupted) ?? null,
    [runs]
  );

  return { runs, activeRun, loading, refresh: load };
}

/**
 * Asks the server to stop an in-flight night run. Returns true when the run
 * was flagged (a 404 means it already finished, which is not an error worth
 * shouting about). The engine only reacts at the next wave boundary, so the
 * caller should keep polling rather than assume an immediate finish.
 */
export async function stopNightRun(
  projectId: string,
  runId: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/projects/${projectId}/build/night-runs/${runId}/stop`,
      { method: "POST" }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Loads one night run's detail (morning summary). Keeps polling while the
 * run is still executing so the dialog can be opened mid-run.
 */
export function useNightRunDetail(
  projectId: string,
  runId: string | null,
  intervalMs: number = 5000
) {
  const [detail, setDetail] = useState<NightRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/build/night-runs/${runId}`
      );
      const json = await res.json();
      if (!res.ok || !json?.data) {
        setDetail(null);
        setError(json?.error ?? "Night run not found");
      } else {
        setDetail(json.data as NightRunDetail);
        setError(null);
      }
    } catch {
      setError("Failed to load the night run summary");
    }
    setLoading(false);
  }, [projectId, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(load, intervalMs, Boolean(runId) && detail?.state === "running", {
    immediate: false,
  });

  return { detail, loading, error, refresh: load };
}
