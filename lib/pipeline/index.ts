import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { epics, settings } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { logTransition } from "@/lib/workflow/log";
import type { AgentProvider } from "@/lib/agent-config/constants";
import { runForensic } from "./forensic";
import {
  DEFAULT_PIPELINE_MAX_ATTEMPTS,
  DEFAULT_PIPELINE_MAX_FIX_CYCLES,
  PIPELINE_ENABLED_SETTING_KEY,
  PIPELINE_MAX_ATTEMPTS_SETTING_KEY,
  PIPELINE_MAX_FIX_CYCLES_SETTING_KEY,
  PIPELINE_MAX_SESSIONS_PER_RUN,
  PIPELINE_REASONS,
  parsePipelineEnabledSetting,
  parsePipelineMaxAttempts,
  parsePipelineMaxFixCycles,
  pipelineEnabledSettingKey,
  pipelineMaxAttemptsSettingKey,
  pipelineMaxFixCyclesSettingKey,
} from "./constants";
import { pipelineRegistry, listPipelineRunsByProject } from "./registry";
import { createPipelineStageDriver } from "./stages";
import { runPipeline, type PipelineStageResult } from "./runner";

/**
 * Autonomous pipeline entry point (build → review → auto-fix → forensic).
 *
 * `startPipelineRun` is called by the two single-ticket build routes AFTER
 * they created their own build session and wrapped its launch closure with
 * the settle pattern. It registers the run, wires the real stage drivers
 * into the pure runner, and returns synchronously — the run continues in the
 * background exactly like the DAG wave engine outlives its HTTP request.
 *
 * Success leaves the ticket in 'review': the pipeline never auto-approves
 * (review → done stays human-gated by the workflow engine). asked_question
 * at any stage pauses the run terminally; stopping the live stage session
 * stops the pipeline.
 */

export interface StartPipelineRunInput {
  projectId: string;
  scope: "epic" | "story";
  epicId: string;
  userStoryId: string | null;
  buildSessionId: string;
  buildProvider: AgentProvider;
  buildNamedAgentId: string | null;
  buildSettled: Promise<PipelineStageResult>;
}

function readSettingValue(key: string): string | null {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? null;
}

/**
 * Effective "run the pipeline by default" answer for a project:
 * `pipeline_enabled:<projectId>` → `pipeline_enabled` → OFF. An explicit
 * request flag beats both (handled by the routes).
 */
export function resolvePipelineEnabled(projectId: string): boolean {
  for (const key of [
    pipelineEnabledSettingKey(projectId),
    PIPELINE_ENABLED_SETTING_KEY,
  ]) {
    const parsed = parsePipelineEnabledSetting(readSettingValue(key));
    if (parsed !== null) return parsed;
  }
  return false;
}

function resolveCap(
  keys: string[],
  parse: (value: unknown) => number | null,
  fallback: number
): number {
  for (const key of keys) {
    const raw = readSettingValue(key);
    if (raw === null) continue;
    const parsed = parse(raw);
    if (parsed !== null) return parsed;
  }
  return fallback;
}

/** Per-stage attempt cap: project override → global → default 2 (clamped 1..5). */
export function resolvePipelineMaxAttempts(projectId: string): number {
  return resolveCap(
    [
      pipelineMaxAttemptsSettingKey(projectId),
      PIPELINE_MAX_ATTEMPTS_SETTING_KEY,
    ],
    parsePipelineMaxAttempts,
    DEFAULT_PIPELINE_MAX_ATTEMPTS
  );
}

/** Fix-cycle cap: project override → global → default 2 (clamped 0..5). */
export function resolvePipelineMaxFixCycles(projectId: string): number {
  return resolveCap(
    [
      pipelineMaxFixCyclesSettingKey(projectId),
      PIPELINE_MAX_FIX_CYCLES_SETTING_KEY,
    ],
    parsePipelineMaxFixCycles,
    DEFAULT_PIPELINE_MAX_FIX_CYCLES
  );
}

/**
 * Registers and starts one pipeline run. Synchronous return (the engine
 * runs in the background); every failure after this point surfaces through
 * the activity trace + registry snapshot, never as a thrown error.
 */
export function startPipelineRun(input: StartPipelineRunInput): {
  runId: string;
} {
  const runId = createId();
  const startedAt = new Date().toISOString();

  pipelineRegistry.register({
    runId,
    projectId: input.projectId,
    epicId: input.epicId,
    userStoryId: input.userStoryId,
    state: "running_build",
    stage: "build",
    stageAttempt: 1,
    fixCycles: 0,
    sessionIds: [input.buildSessionId],
    startedAt,
    endedAt: null,
    reason: null,
  });

  // Activity trace: actor 'system', from == to (current epic status). Story
  // runs log on the parent epic, matching reviewComments keying.
  const trace = (reason: string, sessionId: string | null): void => {
    try {
      const epicStatus =
        db
          .select({ status: epics.status })
          .from(epics)
          .where(eq(epics.id, input.epicId))
          .get()?.status ?? "in_progress";
      logTransition({
        projectId: input.projectId,
        epicId: input.epicId,
        fromStatus: epicStatus,
        toStatus: epicStatus,
        actor: "system",
        reason,
        sessionId: sessionId ?? undefined,
      });
    } catch (error) {
      console.warn(
        "[pipeline] Failed to write activity trace:",
        error instanceof Error ? error.message : error
      );
    }
  };

  trace(PIPELINE_REASONS.started, input.buildSessionId);

  const driver = createPipelineStageDriver({
    projectId: input.projectId,
    scope: input.scope,
    epicId: input.epicId,
    userStoryId: input.userStoryId,
    buildNamedAgentId: input.buildNamedAgentId,
  });

  const engine = runPipeline({
    maxAttempts: resolvePipelineMaxAttempts(input.projectId),
    maxFixCycles: resolvePipelineMaxFixCycles(input.projectId),
    maxSessions: PIPELINE_MAX_SESSIONS_PER_RUN,
    initialBuild: {
      sessionId: input.buildSessionId,
      settled: input.buildSettled,
    },
    launchStage: driver.launchStage,
    assessReview: driver.assessReview,
    readSessionStatus: driver.readSessionStatus,
    checkGuards: driver.checkGuards,
    runForensic: (forensicInput) =>
      runForensic({
        projectId: input.projectId,
        epicId: input.epicId,
        userStoryId: input.userStoryId,
        deadSessionId: forensicInput.deadSessionId,
        stage: forensicInput.stage,
        attempts: forensicInput.attempts,
      }),
    callbacks: {
      onStageChange: (state, stage, stageAttempt, fixCycles) => {
        try {
          pipelineRegistry.update(runId, {
            state,
            stage,
            stageAttempt,
            fixCycles,
          });
        } catch {
          // registry updates are best-effort
        }
      },
      onSessionAdded: (sessionId) => {
        try {
          pipelineRegistry.recordSession(runId, sessionId);
        } catch {
          // best-effort
        }
      },
      onTrace: trace,
      onFinish: (summary) => {
        try {
          pipelineRegistry.finish(runId, summary.state, summary.reason);
        } catch {
          // best-effort
        }
      },
    },
  });

  // The engine outlives the HTTP request. Per-stage failures feed the retry
  // ladder, so a rejection here is an engine bug — log it and close the
  // run's snapshot so it cannot look active forever.
  void engine.catch((error) => {
    console.error(`[pipeline] Run ${runId} crashed`, error);
    try {
      pipelineRegistry.finish(runId, "failed", "pipeline engine error");
    } catch {
      // best-effort
    }
  });

  return { runId };
}

export { listPipelineRunsByProject, pipelineRegistry };
export type { PipelineStageResult };
export type { PipelineRunSnapshot } from "./constants";
