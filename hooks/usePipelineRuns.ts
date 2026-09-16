"use client";

import { useMemo } from "react";
import { usePolledResource } from "@/hooks/usePolledResource";
const loadError = () => "Unable to load pipeline runs";
const isRuns = (value: unknown): value is PipelineRunSnapshot[] => Array.isArray(value);
const EMPTY_RUNS: PipelineRunSnapshot[] = [];
import {
  isPipelineRunActive,
  type PipelineRunSnapshot,
  type PipelineStage,
} from "@/lib/pipeline/constants";

/** What the session-row chip needs to know about one session. */
export interface PipelineSessionInfo {
  runId: string;
  /**
   * Stage the session belongs to. Only knowable for the run's live session
   * (the newest id in `sessionIds`); earlier sessions render an unqualified
   * "Pipeline" chip since the snapshot does not carry per-session stages.
   */
  stage: PipelineStage | null;
  /** False once the run reached a terminal state. */
  active: boolean;
}

/**
 * Builds the sessionId → pipeline info lookup from a list of run snapshots.
 * Exported pure so the mapping is testable without rendering.
 *
 * Later runs win on collision (a session can only belong to one run, but a
 * defensive last-write-wins keeps the newest snapshot authoritative).
 */
export function indexPipelineSessions(
  runs: PipelineRunSnapshot[]
): Record<string, PipelineSessionInfo> {
  const index: Record<string, PipelineSessionInfo> = {};
  for (const run of runs ?? []) {
    // Defensive: the poller feeds this straight from an API payload.
    const sessionIds = Array.isArray(run?.sessionIds) ? run.sessionIds : [];
    if (sessionIds.length === 0) continue;
    const active = isPipelineRunActive(run.state);
    const liveSessionId = sessionIds[sessionIds.length - 1] ?? null;
    for (const sessionId of sessionIds) {
      index[sessionId] = {
        runId: run.runId,
        stage: active && sessionId === liveSessionId ? (run.stage ?? null) : null,
        active,
      };
    }
  }
  return index;
}

/** "Pipeline · Review" / "Pipeline" — the chip label for one session. */
export function pipelineChipLabel(info: PipelineSessionInfo, copy: { pipeline: string; stage: (stage: PipelineStage) => string }): string {
  return info.stage
    ? copy.stage(info.stage)
    : copy.pipeline;
}

/**
 * Polls the project's pipeline runs (active runs plus the registry's recent
 * ring) and exposes the sessionId → run lookup used to badge session rows.
 *
 * Best-effort like the other monitor pollers: a failed request leaves the
 * previous snapshot in place rather than clearing the chips.
 */
export function usePipelineRuns(
  projectId: string,
  enabled: boolean = true,
  intervalMs: number = 5000
) {
  const { data, loading, error, refresh } = usePolledResource<PipelineRunSnapshot[]>(enabled && projectId ? `/api/projects/${projectId}/pipeline/runs` : null, intervalMs, loadError, { validateData: isRuns });
  const runs = data ?? EMPTY_RUNS;
  const sessionIndex = useMemo(() => indexPipelineSessions(runs), [runs]);

  return {
    runs,
    loading,
    sessionIndex,
    error, refresh,
  };
}
