import {
  readCompositeMemberCount,
  resolveAgentByNamedId,
  resolveAgentForDispatch,
  resolveCompositeMemberAtRank,
  type ResolvedAgent,
} from "@/lib/agent-config/agent-resolution";
import { GRADING_AGENT_TYPE } from "@/lib/grading/dispatch";
import type { AgentType } from "@/lib/agent-config/constants";
import type { PipelineStageKind, PipelineStageRequest } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";

/**
 * Agent selection for one pipeline stage dispatch — the retry ladder.
 *
 * Retry ladder per stage — BINARY, with no third path:
 *
 *   SIMPLE AGENT — every attempt runs the SAME agent. Attempt 1 is the
 *                as-configured resolution (build/fix via
 *                resolveAgentByNamedId with the run's ORIGINAL namedAgentId;
 *                review via resolveAgentForDispatch purpose 'review' with the
 *                run's reviewNamedAgentId — null for every caller but Full
 *                Auto Mode, so reviewer segregation can act as before; an
 *                explicit review agent, when set, wins over segregation).
 *                Attempt 2 RESUMES the failed attempt's session when the
 *                machinery allows (the resume decision itself lives in
 *                stage-resume.ts); later attempts start fresh. No attempt ever
 *                switches agent or provider, and the attempt cap is
 *                `pipeline_max_attempts`.
 *
 *   COMPOSITE    — attempt N runs the member at position N-1, and the LENGTH
 *                OF THE LIST is the attempt budget. Nothing is resumed: each
 *                attempt is a different agent, and a stored cliSessionId only
 *                means something to the CLI that created it.
 *
 * What used to sit at attempts 3 and 3+ — the same-provider effort hop and
 * the first-available-alternative-provider hop — is gone. Neither was
 * reachable under the default attempt cap of 2, and the provider hop threw
 * the named agent away to run a CLI's default model.
 * `pickAlternativeReviewProvider()` survives; it is still what reviewer
 * segregation uses to keep a reviewer off the builder's provider.
 */

export interface ResolvedStageAgent {
  resolved: ResolvedAgent;
  /**
   * Set when this attempt moved DOWN one rank of a composite. Carries both
   * ends of the move so the runner's activity trace can name the member that
   * was abandoned as well as the one that replaces it.
   */
  compositeDescent: { from: string; to: string } | null;
}

/**
 * The stage's AS-CONFIGURED agent, before the ladder picks a rank.
 *
 * Sizing the budget and picking the agent both need this, and they used to
 * each resolve it for themselves — twice per stage entry. For a review that is
 * not merely duplicated work: the path dynamic-imports ./review-segregation,
 * runs `findLastSuccessfulBuildProvider`, and when the default resolution
 * matches the builder's provider it awaits `getProvider(p).isAvailable()`
 * across PROVIDER_OPTIONS until one answers — real subprocess probes, paid
 * twice.
 *
 * It was also a correctness smell. The two calls were independent, and
 * `findLastSuccessfulBuildProvider` is a live query, so a segregation decision
 * that flipped between them would size the ladder from one resolution and run
 * another. Resolving once and sharing the result removes the window rather
 * than relying on the two agreeing.
 */
export async function resolveConfiguredStageAgent(
  init: PipelineStageDriverInit,
  stage: PipelineStageKind,
  codeAgentType: AgentType,
  reviewAgentType: AgentType
): Promise<ResolvedAgent> {
  if (stage === "review" || stage === "grading") {
    return resolveAgentForDispatch(
      stage === "grading" ? GRADING_AGENT_TYPE : reviewAgentType,
      init.projectId,
      stage === "grading" ? null : init.reviewNamedAgentId ?? null,
      {
        purpose: stage === "grading" ? "grading" : "review",
        projectId: init.projectId,
        epicId: init.epicId,
        ...(init.scope === "story" && init.userStoryId
          ? { storyId: init.userStoryId }
          : {}),
      }
    );
  }
  return resolveAgentByNamedId(
    codeAgentType,
    init.projectId,
    init.buildNamedAgentId
  );
}

/**
 * Attempt budget for `stage`: how many attempts its configured agent affords.
 *
 * A SIMPLE agent keeps the configured `pipeline_max_attempts` — it is retried
 * as itself, so the cap is the only thing bounding it. A COMPOSITE's budget is
 * its member count, because each attempt descends a rank and there is nothing
 * below the last member; `pipeline_max_attempts` no longer governs an agent
 * switch, which is the setting's whole former purpose here.
 */
export async function resolveStageAttemptBudget(
  configured: ResolvedAgent | null,
  configuredMaxAttempts: number
): Promise<number> {
  // A resolution that already failed (an emptied composite) reports 1 rather
  // than propagating: the dispatch itself will fail with the real message,
  // and that is a clearer failure than one raised while merely sizing.
  if (!configured) return 1;
  if (!configured.compositeAgentId) return configuredMaxAttempts;
  const count = readCompositeMemberCount(configured.compositeAgentId);
  return count && count > 0 ? count : 1;
}

/**
 * Picks the stage's agent for `request.attempt`.
 *
 * TWO SHAPES, AND NO THIRD. A simple agent is retried as ITSELF at every
 * attempt — attempt 2 resumes its failed session where the machinery allows
 * (see stage-resume.ts), later attempts start fresh, and no attempt ever
 * switches agent or provider. A composite descends one rank per attempt:
 * attempt N runs the member at position N-1.
 */
export function resolveStageAgent(
  request: PipelineStageRequest,
  configured: ResolvedAgent
): ResolvedStageAgent {
  // Simple agent — every attempt, including the first, is this agent.
  if (!configured.compositeAgentId) {
    return { resolved: configured, compositeDescent: null };
  }

  const compositeId = configured.compositeAgentId;
  const rank = request.attempt - 1;
  if (rank <= 0) {
    // Attempt 1 already IS rank 0: `configured` is the unfolded first member.
    return { resolved: configured, compositeDescent: null };
  }

  const step = resolveCompositeMemberAtRank(compositeId, rank);
  if (!step.resolved) {
    // The runner sizes the ladder from the same member count, so asking past
    // the end is a bug rather than a normal end of run. Fail loudly instead
    // of re-running the member that just failed.
    throw new Error(
      `Composite agent has no member at rank ${rank} (${step.memberCount} members)`
    );
  }

  const previous = resolveCompositeMemberAtRank(compositeId, rank - 1);
  return {
    resolved: step.resolved,
    compositeDescent: {
      from: previous.resolved?.name ?? `rank ${rank - 1}`,
      to: step.resolved.name ?? `rank ${rank}`,
    },
  };
}
