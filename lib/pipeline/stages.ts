import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { loadPromptComments } from "@/lib/claude/prompt-comments";
import {
  agentSessions,
  epics,
  projects,
  userStories,
} from "@/lib/db/schema";
import { createWorktree } from "@/lib/git/manager";
import {
  REVIEW_TYPE_TO_AGENT_TYPE,
  type AgentType,
} from "@/lib/agent-config/constants";
import {
  readCompositeMemberCount,
  type ResolvedAgent,
} from "@/lib/agent-config/agent-resolution";
import type { PromptComment } from "@/lib/claude/prompt-builder";
import { createPromptSectionCapture } from "@/lib/tokens/dispatch-prompt";
import { PIPELINE_REVIEW_TYPE } from "./constants";
import type {
  PipelineDeterministicVerificationOutcome,
  PipelineGuardCheck,
  PipelineGradingAssessment,
  PipelineReviewAssessment,
  PipelineStageHandle,
  PipelineStageKind,
  PipelineStageRequest,
} from "./runner";
import {
  resolveConfiguredStageAgent,
  resolveStageAgent,
  resolveStageAttemptBudget,
} from "./stage-agent";
import { buildCodeStagePrompt } from "./stage-code";
import type { PipelineStageDriverInit } from "./stage-driver-init";
import {
  assessPipelineGrading,
  dispatchPipelineGradingStage,
} from "./stage-grading";
import { checkPipelineGuards } from "./stage-guards";
import { finalizeStagePrompt } from "./stage-prompt";
import { resolveStageResume } from "./stage-resume";
import { assessPipelineReview, buildReviewStagePrompt } from "./stage-review";
import { launchStageSession } from "./stage-session";
import { runPipelineVerification } from "./stage-verification";

export { PIPELINE_FIX_INSTRUCTIONS_SECTION } from "./stage-code";
export type { PipelineStageDriverInit } from "./stage-driver-init";
export { PIPELINE_REVIEW_LABEL } from "./stage-review";

/**
 * Real stage launchers for the pipeline runner: review, fix, and build-retry
 * sessions dispatched from this library (not the HTTP routes), replicating
 * the corresponding route closures byte-for-byte in behavior so the board
 * cannot tell a pipeline stage from a human dispatch.
 *
 * This module is the driver: it wires the runner's contract to the stage
 * modules and sequences one dispatch. The stages themselves live next door,
 * one module each:
 *   stage-driver-init.ts  — the per-run identity every module receives
 *   stage-agent.ts        — retry ladder: the as-configured resolution, its
 *                           attempt budget, and who runs attempt N
 *   stage-resume.ts       — retry ladder: whether attempt N resumes a session
 *   stage-prompt.ts       — open-findings blocks, mentions, token estimate
 *   stage-code.ts         — build/fix prompt + post-completion effects
 *   stage-review.ts       — review prompt, findings assessment, verdict effects
 *   stage-session.ts      — session row, launch closure, scheduler submit
 *   stage-guards.ts       — target-conflict + review-status probe
 *   stage-verification.ts — deterministic verification driver
 *   stage-grading.ts      — grading dispatch adapter + report read-back
 */

export interface PipelineStageDriver {
  launchStage(request: PipelineStageRequest): Promise<PipelineStageHandle>;
  /**
   * Attempts `stage` may spend: the configured cap for a simple agent, the
   * member count for a composite. The runner asks once per stage entry.
   */
  attemptBudget(
    stage: PipelineStageKind,
    configuredMaxAttempts: number
  ): Promise<number>;
  /**
   * The ladder the stage's agent affords a caller that retries OUTSIDE the
   * runner: the member count when that agent is a COMPOSITE — the length of
   * the list is what the ladder spends — or null for a simple agent, which is
   * retried as itself under the caller's own cap.
   *
   * Full Auto dispatches each stage itself and derives the attempt from the
   * ticket's failure streak, so it needs the count without the runner's
   * budget vocabulary. Resolved through the same cache `launchStage` reads,
   * so the ladder and the member this dispatch spends come from ONE
   * resolution — the review path is live-query-backed and probes providers,
   * and two independent resolutions could disagree mid-flight.
   */
  compositeMemberCount(stage: PipelineStageKind): Promise<number | null>;
  runDeterministicVerification(
    lastCodeSessionId: string | null
  ): Promise<PipelineDeterministicVerificationOutcome>;
  assessReview(input: {
    sessionId: string;
    stageStartedAt: string;
  }): Promise<PipelineReviewAssessment>;
  assessGrading(input: {
    sessionId: string;
    reportId: string;
  }): Promise<PipelineGradingAssessment>;
  readSessionStatus(sessionId: string): string | null;
  checkGuards(ownSessionIds: string[]): PipelineGuardCheck;
}

/**
 * Builds the driver the runner is wired with. One driver per run — it
 * carries the per-run review-output cache used by the prose fallback.
 */
export function createPipelineStageDriver(
  init: PipelineStageDriverInit
): PipelineStageDriver {
  /** sessionId → review output, captured by the review closure. */
  const reviewOutputs = new Map<string, string>();

  const codeAgentType: AgentType =
    init.scope === "epic" ? "build" : "ticket_build";
  const reviewAgentType: AgentType =
    REVIEW_TYPE_TO_AGENT_TYPE[PIPELINE_REVIEW_TYPE];

  /**
   * The as-configured resolution for the stage entry currently in flight.
   *
   * Populated when the runner sizes the ladder (`attemptBudget`, attempt 1)
   * and read by every attempt of that stage entry, so the budget and the
   * agents it spends come from ONE resolution rather than from independent
   * repeats of an expensive, live-query-backed path.
   */
  const configuredByStage = new Map<PipelineStageKind, ResolvedAgent>();

  const configuredAgent = async (
    stage: PipelineStageKind,
    refresh = false
  ): Promise<ResolvedAgent> => {
    const cached = configuredByStage.get(stage);
    if (cached && !refresh) return cached;
    const resolved = await resolveConfiguredStageAgent(
      init,
      stage,
      codeAgentType,
      reviewAgentType
    );
    configuredByStage.set(stage, resolved);
    return resolved;
  };

  return {
    attemptBudget: async (stage, configuredMaxAttempts) => {
      // A new stage entry: re-resolve rather than reuse the previous entry's
      // answer, since a run can revisit review after a fix cycle.
      let configured: ResolvedAgent | null = null;
      try {
        configured = await configuredAgent(stage, true);
      } catch {
        // An emptied composite. Leave the cache untouched so the dispatch
        // raises the real error rather than this sizing call.
        configuredByStage.delete(stage);
      }
      return resolveStageAttemptBudget(configured, configuredMaxAttempts);
    },

    compositeMemberCount: async (stage) => {
      let configured: ResolvedAgent | null = null;
      try {
        configured = await configuredAgent(stage);
      } catch {
        // An emptied composite. Reported as "no ladder" rather than thrown:
        // the dispatch itself must raise the real, actionable refusal.
        return null;
      }
      const count = readCompositeMemberCount(configured.compositeAgentId);
      return count && count > 0 ? count : null;
    },

    launchStage: async (request) => {
      try {
        if (request.stage === "grading") {
          return await dispatchPipelineGradingStage(init, request, configuredAgent);
        }
        return await dispatchPipelineStage(
          init,
          request,
          reviewOutputs,
          configuredAgent
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Stage dispatch failed";
        console.warn(
          `[pipeline] ${request.stage} dispatch failed (attempt ${request.attempt}):`,
          message
        );
        return {
          sessionId: null,
          settled: Promise.resolve({
            sessionId: "",
            success: false,
            outcome: null,
            error: message,
          }),
          compositeDescent: null,
        };
      }
    },

    runDeterministicVerification: (lastCodeSessionId) =>
      runPipelineVerification(init, lastCodeSessionId),

    assessReview: ({ sessionId, stageStartedAt }) =>
      assessPipelineReview(init, reviewOutputs, { sessionId, stageStartedAt }),

    assessGrading: ({ sessionId, reportId }) =>
      assessPipelineGrading(init, { sessionId, reportId }),

    readSessionStatus: (sessionId) =>
      db
        .select({ status: agentSessions.status })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .get()?.status ?? null,

    checkGuards: (ownSessionIds) => checkPipelineGuards(init, ownSessionIds),
  };
}

/**
 * Dispatches one pipeline stage session: resolves the agent per the ladder,
 * decides the resume target, builds the prompt, creates the queued session,
 * applies the same dispatch-side status sync as the route counterpart, and
 * submits a launch closure that settles a PipelineStageResult (never
 * rejects) while rethrowing into the scheduler's safety net.
 */
async function dispatchPipelineStage(
  init: PipelineStageDriverInit,
  request: PipelineStageRequest,
  reviewOutputs: Map<string, string>,
  /** The driver's per-stage-entry resolution — see `resolveConfiguredStageAgent`. */
  configuredAgent: (stage: PipelineStageKind) => Promise<ResolvedAgent>
): Promise<PipelineStageHandle> {
  const { projectId, epicId, userStoryId, scope } = init;

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new Error("Project not found");
  if (!project.gitRepoPath) {
    throw new Error("Project has no git repository configured");
  }

  const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!epic) throw new Error("Epic not found");

  const story =
    scope === "story" && userStoryId
      ? db
          .select()
          .from(userStories)
          .where(eq(userStories.id, userStoryId))
          .get()
      : null;
  if (scope === "story" && !story) throw new Error("Story not found");

  const codeAgentType: AgentType = scope === "epic" ? "build" : "ticket_build";
  const reviewAgentType: AgentType =
    REVIEW_TYPE_TO_AGENT_TYPE[PIPELINE_REVIEW_TYPE];
  const isReview = request.stage === "review";
  const agentType = isReview ? reviewAgentType : codeAgentType;

  const { resolved, compositeDescent } = resolveStageAgent(
    request,
    await configuredAgent(request.stage)
  );

  const { cliSessionId, resumeSession } = resolveStageResume(
    init,
    request,
    resolved.provider,
    resolved.compositeAgentId
  );

  // ---------------------------------------------------------------------
  // Context + prompt (mirror of the route counterparts).
  // ---------------------------------------------------------------------
  const usList = db
    .select()
    .from(userStories)
    .where(eq(userStories.epicId, epicId))
    .orderBy(userStories.position)
    .all();

  const promptComments: PromptComment[] = loadPromptComments(
    scope === "story" && userStoryId ? { userStoryId } : { epicId }
  );

  const { worktreePath, branchName } = await createWorktree(
    project.gitRepoPath,
    epic.id,
    epic.title,
    { defaultBranch: project.defaultBranch }
  );

  const promptSections = createPromptSectionCapture();
  const stagePrompt = isReview
    ? await buildReviewStagePrompt({
        init,
        request,
        reviewAgentType,
        project,
        epic,
        story: story ?? null,
        usList,
        promptComments,
        promptSections,
      })
    : await buildCodeStagePrompt({
        init,
        request,
        codeAgentType,
        project,
        epic,
        story: story ?? null,
        usList,
        promptComments,
        promptSections,
      });
  const { prompt, estimatedPrompt } = finalizeStagePrompt({
    projectId,
    epicId,
    stage: request.stage,
    prompt: stagePrompt,
    promptSections,
    promptComments,
  });

  const { sessionId, settled } = launchStageSession({
    init,
    request,
    resolved,
    agentType,
    isReview,
    prompt,
    estimatedPrompt,
    worktreePath,
    branchName,
    cliSessionId,
    resumeSession,
    reviewOutputs,
  });

  return {
    sessionId,
    settled,
    compositeDescent,
  };
}
