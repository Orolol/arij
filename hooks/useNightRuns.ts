"use client";

import { useTranslations } from "next-intl";

import { useCallback } from "react";
import { usePolledResource } from "@/hooks/usePolledResource";
import { fetchJson } from "@/lib/api/client";
const EMPTY_RUNS: NightRunListEntry[] = [];
const isRuns = (value: unknown): value is NightRunListEntry[] => Array.isArray(value);
const isRunning = (detail: NightRunDetail | null) => detail?.state === "running";
import type {
  NightRunDetail,
  NightRunListEntry,
} from "@/lib/night/constants";

/**
 * Polls the project's night runs (the registry's active run plus its recent
 * ring, merged with runs rebuilt from the database).
 *
 * A failed request keeps the previous snapshot *and* raises `error`. Both
 * halves matter: this list is the only durable way back into a past run's
 * morning summary, so a dead request must never be indistinguishable from
 * "this project has no night runs" — the caller needs to tell the two apart.
 *
 * Cadence follows the data: `intervalMs` while a run is live, `idleIntervalMs`
 * otherwise. Terminal history barely changes, and the list route rebuilds every
 * run through per-run and per-epic queries, so idle polling should not pay the
 * live rate — but it does keep polling, so a run starting while the list is
 * open still appears.
 */
export function useNightRuns(
  projectId: string,
  enabled: boolean = true,
  intervalMs: number = 5000,
  idleIntervalMs: number = 30000
) {
  const tErrors = useTranslations("ClientErrors");
  const errorMessage = useCallback(() => tErrors("couldNotLoadNightRuns"), [tErrors]);
  const cadence = useCallback((runs: NightRunListEntry[] | null) => runs?.some((run) => run.state === "running" && !run.interrupted) ? intervalMs : idleIntervalMs, [intervalMs, idleIntervalMs]);
  const { data, loading, error, refresh } = usePolledResource<NightRunListEntry[]>(enabled && projectId ? `/api/projects/${projectId}/build/night-runs` : null, cadence, errorMessage, { validateData: isRuns });
  const runs = data ?? EMPTY_RUNS;
  const activeRun = runs.find((run) => run.state === "running" && !run.interrupted) ?? null;
  return { runs, activeRun, loading, error, refresh };
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
  const response = await fetchJson(`/api/projects/${projectId}/build/night-runs/${runId}/stop`, { method: "POST" });
  return response?.ok ?? false;
}

export function useNightRunDetail(
  projectId: string,
  runId: string | null,
  intervalMs: number = 5000
) {
  const tErrors = useTranslations("ClientErrors");
  const errorMessage = useCallback((status?: number) => status === undefined ? tErrors("failedToLoadTheNightRunSummary") : tErrors("nightRunNotFound"), [tErrors]);
  const { data: detail, loading, error, refresh } = usePolledResource<NightRunDetail>(projectId && runId ? `/api/projects/${projectId}/build/night-runs/${runId}` : null, intervalMs, errorMessage, { pollWhen: isRunning });
  return { detail, loading, error, refresh };
}
