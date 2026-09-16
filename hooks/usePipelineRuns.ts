"use client";

import { useMemo } from "react";
import { usePolledResource } from "@/hooks/usePolledResource";
import {
  isPipelineRunActive,
  type PipelineRunSnapshot,
  type PipelineStage,
} from "@/lib/pipeline/constants";

const loadError = () => "Unable to load pipeline runs";
const isRuns = (value: unknown): value is PipelineRunSnapshot[] => Array.isArray(value);
const EMPTY_RUNS: PipelineRunSnapshot[] = [];

/**
 * Poll cadence of the ticket overlay's run read WHILE a run is active. The
 * runner's stage changes ride on session:started / session:completed /
 * session:failed, but its assessment steps between sessions (grading verdict,
 * guard failure, the terminal state itself) emit nothing — this slow tick is
 * what catches those. An idle ticket is never polled.
 */
export const TICKET_PIPELINE_RUN_POLL_MS = 10_000;

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
 * ring) and exposes the sessionId → run lookup behind the story page's
 * "Pipeline · <stage>" chip — its only reader.
 *
 * Best-effort like the other monitor pollers: a failed request leaves the
 * previous snapshot in place rather than clearing the chips.
 */
export function usePipelineRuns(
  projectId: string,
  enabled: boolean = true,
  intervalMs: number = 5000
) {
  const { data } = usePolledResource<PipelineRunSnapshot[]>(enabled && projectId ? `/api/projects/${projectId}/pipeline/runs` : null, intervalMs, loadError, { validateData: isRuns });
  const runs = data ?? EMPTY_RUNS;
  const sessionIndex = useMemo(() => indexPipelineSessions(runs), [runs]);

  return { sessionIndex };
}

/**
 * The ticket's latest run in a registry listing. The route lists active runs
 * first, then the terminal ring, each newest first.
 *
 * A story build registers under its parent's epicId, so the listing mixes the
 * ticket's own runs with its stories'. Ranked, first match wins:
 *   1. the ticket's own active run;
 *   2. a story's active run (the card names the story);
 *   3. the ticket's own most recent finished run;
 *   4. a story's most recent finished run.
 * Live work outranks history, and at equal liveness the ticket outranks its
 * stories — a story's failure must not pass for the ticket's.
 */
export function latestTicketRun(
  runs: readonly PipelineRunSnapshot[] | null | undefined,
  epicId: string | null | undefined,
): PipelineRunSnapshot | null {
  if (!epicId || !Array.isArray(runs)) return null;
  const mine = runs.filter((run) => run?.epicId === epicId);
  const rank = (run: PipelineRunSnapshot) =>
    (isPipelineRunActive(run.state) ? 0 : 2) + (run.userStoryId == null ? 0 : 1);
  let best: PipelineRunSnapshot | null = null;
  for (const run of mine) {
    if (!best || rank(run) < rank(best)) best = run;
  }
  return best;
}

const ticketRunCadence = (runs: PipelineRunSnapshot[] | null) =>
  runs?.some((run) => isPipelineRunActive(run.state))
    ? TICKET_PIPELINE_RUN_POLL_MS
    : null;

/**
 * One ticket's latest pipeline run, for the overlay's PIPELINE card.
 *
 * Read once on open, re-read through `refresh` (the overlay calls it from its
 * existing project-event subscription), and polled slowly only while the
 * ticket has an active run. A failed read keeps the last snapshot, and a
 * ticket that never had one gets `null` — the card then derives its chain
 * from the column as before.
 */
export function useTicketPipelineRun(
  projectId: string,
  epicId: string | null,
  enabled: boolean = true,
) {
  const url =
    enabled && projectId && epicId
      ? `/api/projects/${projectId}/pipeline/runs?epicId=${encodeURIComponent(epicId)}`
      : null;
  const { data, refresh } = usePolledResource<PipelineRunSnapshot[]>(
    url,
    ticketRunCadence,
    loadError,
    { validateData: isRuns },
  );
  const run = useMemo(() => latestTicketRun(data, epicId), [data, epicId]);
  return { run, refresh };
}
