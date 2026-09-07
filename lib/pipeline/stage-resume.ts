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
 * attempt 1 resumes the run's previous code-writing session. Escalated
 * attempts always start fresh.
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
  provider: AgentProvider
): StageResumeDecision {
  const { epicId, scope, userStoryId } = init;

  let resumeTarget: string | null = null;
  if (request.attempt === 2) {
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
