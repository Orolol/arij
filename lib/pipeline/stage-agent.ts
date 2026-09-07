import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, namedAgents } from "@/lib/db/schema";
import {
  resolveAgentByNamedId,
  resolveAgentForDispatch,
  type ResolvedAgent,
} from "@/lib/agent-config/agent-resolution";
import { pickAlternativeReviewProvider } from "@/lib/agent-config/review-segregation";
import type { AgentProvider, AgentType } from "@/lib/agent-config/constants";
import type { PipelineStageRequest } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";

/**
 * Agent selection for one pipeline stage dispatch — the retry ladder.
 *
 * Retry ladder per stage (deterministic by attempt index):
 *   attempt 1  — as-configured resolution: build/fix via resolveAgentByNamedId
 *                with the run's ORIGINAL namedAgentId; review via
 *                resolveAgentForDispatch purpose 'review' with the run's
 *                reviewNamedAgentId — null for every caller but Full Auto
 *                Mode, so reviewer segregation can act as before; an explicit
 *                review agent, when set, wins over segregation.
 *   attempt 2  — RESUME the failed attempt's session when the machinery
 *                allows (validateResumeSession — failed sessions keep their
 *                cliSessionId; status is not checked), same provider/agent;
 *                fresh otherwise. (The resume decision itself lives in
 *                stage-resume.ts.)
 *   attempt 3  — when the failed named agent has escalatesTo configured,
 *                start fresh on that stronger named agent (same provider).
 *                Without that opt-in edge, this is byte-for-byte the legacy
 *                provider-escalation attempt below.
 *   attempt 3+ — ESCALATE to the first available alternative provider when
 *                no model escalation occupied attempt 3; with an escalatesTo
 *                edge, provider escalation starts at attempt 4. The generic
 *                picker is pickAlternativeReviewProvider despite its name.
 *                namedAgentId null, model undefined (provider default).
 */

interface PreviousSessionRow {
  id: string;
  provider: string | null;
  namedAgentId: string | null;
}

function readSessionAgent(sessionId: string): PreviousSessionRow | null {
  return (
    db
      .select({
        id: agentSessions.id,
        provider: agentSessions.provider,
        namedAgentId: agentSessions.namedAgentId,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get() ?? null
  );
}

function readEffortEscalationTarget(
  namedAgentId: string,
  provider: AgentProvider
): ResolvedAgent | null {
  const source = db
    .select({ escalatesTo: namedAgents.escalatesTo })
    .from(namedAgents)
    .where(eq(namedAgents.id, namedAgentId))
    .get();
  if (!source?.escalatesTo) return null;

  const target = db
    .select({
      id: namedAgents.id,
      name: namedAgents.name,
      provider: namedAgents.provider,
      model: namedAgents.model,
    })
    .from(namedAgents)
    .where(eq(namedAgents.id, source.escalatesTo))
    .get();

  // The write service enforces this invariant. Keep the dispatch-side check
  // so a database edited outside Arij can never turn effort escalation into
  // an unannounced provider switch.
  if (!target || target.provider !== provider) return null;
  return {
    provider,
    namedAgentId: target.id,
    name: target.name,
    model: target.model,
  };
}

export interface ResolvedStageAgent {
  resolved: ResolvedAgent;
  escalatedToNamedAgent: string | null;
  escalatedToProvider: AgentProvider | null;
}

/** Applies the D5b ladder to pick the stage's agent. */
export async function resolveStageAgent(
  init: PipelineStageDriverInit,
  request: PipelineStageRequest,
  codeAgentType: AgentType,
  reviewAgentType: AgentType
): Promise<ResolvedStageAgent> {
  let configured: ResolvedAgent | null = null;
  const resolveConfigured = async (): Promise<ResolvedAgent> => {
    if (configured) return configured;
    if (request.stage === "review") {
      configured = await resolveAgentForDispatch(
        reviewAgentType,
        init.projectId,
        init.reviewNamedAgentId ?? null,
        {
          purpose: "review",
          projectId: init.projectId,
          epicId: init.epicId,
          ...(init.scope === "story" && init.userStoryId
            ? { storyId: init.userStoryId }
            : {}),
        }
      );
      return configured;
    }
    configured = resolveAgentByNamedId(
      codeAgentType,
      init.projectId,
      init.buildNamedAgentId
    );
    return configured;
  };

  if (request.attempt < 3) {
    return {
      resolved: await resolveConfigured(),
      escalatedToNamedAgent: null,
      escalatedToProvider: null,
    };
  }

  // Escalation always starts fresh. If the failed named agent opted into a
  // stronger same-provider model, that occupies attempt 3. Otherwise attempt
  // 3 retains the exact historical alternative-provider path.
  const previous = request.previousAttemptSessionId
    ? readSessionAgent(request.previousAttemptSessionId)
    : null;
  const baseProvider = (previous?.provider ??
    (await resolveConfigured()).provider) as AgentProvider;
  if (request.attempt === 3) {
    const sourceNamedAgentId =
      previous !== null
        ? previous.namedAgentId
        : (await resolveConfigured()).namedAgentId ?? null;
    if (sourceNamedAgentId) {
      const effortTarget = readEffortEscalationTarget(
        sourceNamedAgentId,
        baseProvider
      );
      if (effortTarget) {
        return {
          resolved: effortTarget,
          escalatedToNamedAgent:
            effortTarget.name ?? effortTarget.namedAgentId ?? "stronger agent",
          escalatedToProvider: null,
        };
      }
    }
  }

  // Provider escalation: first available alternative to the failed attempt's
  // provider; same provider when none is installed. The named agent is
  // dropped and the provider's default model is used.
  const alternative = await pickAlternativeReviewProvider(baseProvider);
  if (alternative) {
    return {
      resolved: { provider: alternative, namedAgentId: null },
      escalatedToNamedAgent: null,
      escalatedToProvider: alternative,
    };
  }
  return {
    resolved: { provider: baseProvider, namedAgentId: null },
    escalatedToNamedAgent: null,
    escalatedToProvider: null,
  };
}
