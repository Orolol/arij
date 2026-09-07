import { validateResumeSession } from "@/lib/agent-sessions/validate-resume";
import {
  isResumableProvider,
  providerReportsOwnSessionId,
} from "@/lib/agent-sessions/resume-capability";
import type { AgentProvider } from "@/lib/agent-config/constants";
import type { PipelineStageRequest } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";

/**
 * Resume decision of one stage dispatch.
 *
 * Targets: attempt 2 resumes the failed attempt of THIS stage; a fix's
 * attempt 1 resumes the run's previous code-writing session.
 *
 * A COMPOSITE never resumes: attempt 2 is a DIFFERENT agent, and the stored
 * cliSessionId only means something to the CLI that created it. Resuming one
 * agent's session on another is exactly the cross-provider hand-off
 * validateResumeSession refuses — the check below is the explicit half of
 * that, so the intent survives a future edit to the resume machinery.
 *
 * `isResumableProvider` (lib/agent-sessions/resume-capability.ts) is the
 * single truth for resume support. The build routes' local lists — which
 * wrongly included codex — now defer to it too.
 */
export interface StageResumeDecision {
  /** CLI session id to run under (resumed or freshly minted); undefined = none. */
  cliSessionId: string | undefined;
  resumeSession: boolean;
}

export function resolveStageResume(
  init: Pick<PipelineStageDriverInit, "epicId" | "scope" | "userStoryId">,
  request: PipelineStageRequest,
  provider: AgentProvider,
  /** The composite this attempt's agent was unfolded from, when there is one. */
  compositeAgentId?: string | null
): StageResumeDecision {
  const { epicId, scope, userStoryId } = init;

  let resumeTarget: string | null = null;
  if (request.attempt === 2 && !compositeAgentId) {
    resumeTarget = request.previousAttemptSessionId;
  } else if (request.attempt === 1 && request.stage === "fix") {
    resumeTarget = request.lastCodeSessionId;
  }

  let cliSessionId: string | undefined;
  let resumeSession = false;
  if (resumeTarget && isResumableProvider(provider)) {
    // validateResumeSession enforces the cross-provider guard itself: the
    // stored cliSessionId only means something to the CLI that created it.
    const validated = validateResumeSession({
      resumeSessionId: resumeTarget,
      epicId,
      ...(scope === "story" && userStoryId ? { userStoryId } : {}),
      expectedProvider: provider,
    });
    if (validated) {
      cliSessionId = validated.cliSessionId;
      resumeSession = true;
    }
  }
  // pi announces the session id it created, so minting one here would store
  // an id the CLI never used.
  if (
    !cliSessionId &&
    isResumableProvider(provider) &&
    !providerReportsOwnSessionId(provider)
  ) {
    cliSessionId = crypto.randomUUID();
  }

  return { cliSessionId, resumeSession };
}
