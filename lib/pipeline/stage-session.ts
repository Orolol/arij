import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { agentScheduler } from "@/lib/agents/scheduler";
import { processManager } from "@/lib/claude/process-manager";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import {
  createQueuedSession,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";
import {
  classifySessionOutcome,
  extractSessionUsage,
} from "@/lib/claude/resolve-session-output";
import type { ResolvedAgent } from "@/lib/agent-config/agent-resolution";
import type { AgentType } from "@/lib/agent-config/constants";
import { emitSessionStarted } from "@/lib/events/emit";
import {
  resolveBuildSessionResult,
  transitionBuildStarted,
  type BuildTerminalOutcome,
} from "@/lib/workflow/automatic-transitions";
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

const CODE_ALLOWED_TOOLS = ["Edit", "Write", "Bash", "Read", "Glob", "Grep"];

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
  } = input;
  const { projectId, epicId, userStoryId, scope } = init;

  // ---------------------------------------------------------------------
  // Session row + dispatch-side status sync (mirror of the routes).
  // ---------------------------------------------------------------------
  const sessionId = createId();
  const now = new Date().toISOString();
  const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
  fs.mkdirSync(logsDir, { recursive: true });
  const logsPath = path.join(logsDir, "logs.json");
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

  createQueuedSession({
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
    agentType,
    namedAgentName: resolved.name || null,
    model: resolved.model || null,
    batchRunId: init.batchRunId ?? null,
    createdAt: now,
  });

  if (isReview) {
    if (scope === "epic") {
      emitSessionStarted(projectId, epicId, sessionId, agentType);
    }
  } else if (scope === "epic") {
    emitSessionStarted(projectId, epicId, sessionId, agentType);
  }

  // ---------------------------------------------------------------------
  // Launch closure — replica of the route closure for the stage kind.
  // Returns the {success, outcome, error} triple for the settle wrapper.
  // ---------------------------------------------------------------------
  const runStageSession = async (): Promise<{
    success: boolean;
    outcome: string | null;
    error: string | null;
  }> => {
    markSessionRunning(sessionId);
    processManager.start(
      sessionId,
      {
        mode: agentMode,
        prompt,
        cwd: worktreePath,
        ...(isReview ? {} : { allowedTools: CODE_ALLOWED_TOOLS }),
        model: resolved.model,
        cliSessionId,
        resumeSession,
      },
      resolved.provider
    );

    const info = await waitForProcessCompletion(sessionId);
    const completedAt = new Date().toISOString();
    const result = info?.result;

    try {
      fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
    } catch {
      // ignore
    }

    const outcome = classifySessionOutcome(result, sessionId);

    try {
      markSessionTerminal(
        sessionId,
        {
          success: !!result?.success,
          error: result?.error || null,
          outcome,
          usage: extractSessionUsage(result),
        },
        completedAt
      );
    } catch (error) {
      if (!isSessionLifecycleConflictError(error)) {
        console.error(
          `[pipeline ${request.stage}] Failed to finalize session`,
          error
        );
      }
    }

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
  };

  let settleLaunch!: (result: PipelineStageResult) => void;
  const settled = new Promise<PipelineStageResult>((resolve) => {
    settleLaunch = resolve;
  });

  agentScheduler.submit(projectId, sessionId, async () => {
    try {
      settleLaunch({ sessionId, ...(await runStageSession()) });
    } catch (error) {
      // The scheduler's safety net finalizes the session row; the runner
      // only needs to know this stage settled as failed.
      settleLaunch({
        sessionId,
        success: false,
        outcome: "error",
        error:
          error instanceof Error ? error.message : "Agent launch failed",
      });
      throw error;
    }
  });

  return { sessionId, settled };
}
