import type { ResolvedAgent } from "@/lib/agent-config/agent-resolution";
import type { AgentType } from "@/lib/agent-config/constants";
import { dispatchBuildSession, dispatchReviewSession } from "@/lib/agent-sessions/dispatch-ticket-session";
import { createSessionLogsPath } from "@/lib/agent-sessions/session-paths";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import {
  resolveBuildSessionResult,
  transitionBuildStarted,
  type BuildTerminalOutcome,
} from "@/lib/workflow/automatic-transitions";
import { eq } from "drizzle-orm";
import type { PipelineStageRequest, PipelineStageResult } from "./runner";
import { finalizeCodeSession } from "./stage-code";
import type { PipelineStageDriverInit } from "./stage-driver-init";
import type { EstimatedStagePrompt } from "./stage-prompt";
import { finalizeReviewSession } from "./stage-review";

/**
 * Session row + launch closure of one stage dispatch, shared by the code and
 * review stages: the queued session, the dispatch-side status sync (mirror
 * of the routes), the launch closure that settles a PipelineStageResult
 * (never rejects) while rethrowing into the scheduler's safety net, and the
 * scheduler submission.
 */


export interface StageSessionLaunch {
  sessionId: string;
  /** Resolves (never rejects) when the stage session reaches a terminal state. */
  settled: Promise<PipelineStageResult>;
}

export function launchStageSession(input: {
  init: PipelineStageDriverInit;
  request: PipelineStageRequest;
  resolved: ResolvedAgent;
  agentType: AgentType;
  isReview: boolean;
  prompt: string;
  estimatedPrompt: EstimatedStagePrompt;
  worktreePath: string;
  branchName: string;
  cliSessionId: string | undefined;
  resumeSession: boolean;
  /** sessionId → review output, read by the driver's prose fallback. */
  reviewOutputs: Map<string, string>;
}): StageSessionLaunch {
  const {
    init,
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
  } = input;
  const { projectId, epicId, userStoryId, scope } = init;

  // ---------------------------------------------------------------------
  // Session row + dispatch-side status sync (mirror of the routes).
  // ---------------------------------------------------------------------
  const sessionId = createId();
  const now = new Date().toISOString();
  const logsPath = createSessionLogsPath(sessionId);
  // Reviews run in code mode like builds: plan mode refuses mutating MCP
  // tools (submit_findings, create_bug) regardless of the allowlist, and
  // provider read-only postures cut the tool channel entirely. The
  // no-modification rule for reviewers is a prompt contract
  // (REVIEW_BOUNDARY_SECTION in prompt-builder), not a harness restriction.
  const agentMode = "code";

  if (!isReview) {
    transitionBuildStarted({
      projectId,
      epicId,
      scope,
      userStoryId,
      sessionId,
      reason: "Build agent started",
    });
    db.update(epics)
      .set({ branchName, updatedAt: now })
      .where(eq(epics.id, epicId))
      .run();
  }

  const row = {
    id: sessionId,
    projectId,
    epicId,
    ...(scope === "story" && userStoryId ? { userStoryId } : {}),
    mode: agentMode,
    provider: resolved.provider,
    prompt,
    estimatedPromptTokens: estimatedPrompt.tokens.total,
    estimatedPromptBreakdown: JSON.stringify(
      estimatedPrompt.tokens.breakdown,
    ),
    logsPath,
    branchName,
    worktreePath,
    cliSessionId,
    namedAgentId: resolved.namedAgentId ?? null,
    compositeAgentId: resolved.compositeAgentId ?? null,
    agentType,
    namedAgentName: resolved.name || null,
    model: resolved.model || null,
    batchRunId: init.batchRunId ?? null,
    createdAt: now,
  };

  const dispatch = isReview ? dispatchReviewSession : dispatchBuildSession;
  const dispatched = dispatch({ row, resolvedAgent: resolved, resumeSession,
    onTerminal: ({ result, outcome, completedAt }) => {
    let buildTerminal: BuildTerminalOutcome | null = null;
    if (isReview) {
      finalizeReviewSession({
        init,
        sessionId,
        result,
        outcome,
        completedAt,
        reviewOutputs,
      });
    } else {
      buildTerminal = finalizeCodeSession({
        init,
        sessionId,
        result,
        outcome,
        completedAt,
      });
    }

    const sessionResult = {
      success: !!result?.success,
      outcome,
      error: result?.error ?? null,
    };
    return buildTerminal
      ? resolveBuildSessionResult(buildTerminal, sessionResult)
      : sessionResult;
  }});


  return { sessionId, settled: dispatched.settled };
}
