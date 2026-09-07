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
import type { PromptComment } from "@/lib/claude/prompt-builder";
import { createPromptSectionCapture } from "@/lib/tokens/dispatch-prompt";
import { PIPELINE_REVIEW_TYPE } from "./constants";
import type {
  PipelineDeterministicVerificationOutcome,
  PipelineGuardCheck,
  PipelineGradingAssessment,
  PipelineReviewAssessment,
  PipelineStageHandle,
  PipelineStageRequest,
} from "./runner";
import { resolveStageAgent } from "./stage-agent";
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
 *   stage-agent.ts        — retry ladder: who runs attempt N (resume /
 *                           effort escalation / provider escalation)
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

  return {
    launchStage: async (request) => {
      try {
        if (request.stage === "grading") {
          return await dispatchPipelineGradingStage(init);
        }
        return await dispatchPipelineStage(init, request, reviewOutputs);
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
          escalatedToProvider: null,
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
  reviewOutputs: Map<string, string>
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

  const { resolved, escalatedToNamedAgent, escalatedToProvider } =
    await resolveStageAgent(init, request, codeAgentType, reviewAgentType);

  const { cliSessionId, resumeSession } = resolveStageResume(
    init,
    request,
    resolved.provider
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
    escalatedToNamedAgent,
    escalatedToProvider,
  };
}
