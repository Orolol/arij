import type { PipelineTerminalSummary } from "./runner";
import type { PipelineRunContext } from "./runner-context";
import { runDeterministicVerificationStep } from "./runner-deterministic-verification";
import { dispatchStage } from "./runner-dispatch";
import { runRegressionGateStep } from "./runner-regression-gate";

/**
 * Code stage (build or fix) success handler.
 *
 * Success: Arij-owned deterministic commands, then the bug-specific
 * regression gate, then grading (opt-in) or review. Neither mechanical
 * check creates an agent session or enters sessionIds, so the hard ceiling
 * remains an agent-session ceiling.
 *
 * Returns the terminal summary when the run ended here, or null when the
 * next stage is in flight.
 */
export async function handleCodeStageSuccess(
  ctx: PipelineRunContext
): Promise<PipelineTerminalSummary | null> {
  const { options, state } = ctx;
  state.lastCodeSessionId = state.handle.sessionId ?? state.lastCodeSessionId;

  const verification = await runDeterministicVerificationStep(ctx);
  if (verification.kind === "terminal") return verification.summary;
  if (verification.kind === "dispatched") return null;

  const gate = await runRegressionGateStep(ctx);
  if (gate.kind === "terminal") return gate.summary;
  if (gate.kind === "dispatched") return null;

  const { verificationReport } = verification;
  state.lastVerificationReport = verificationReport;
  return dispatchStage(ctx, {
    stage: options.gradingEnabled ? "grading" : "review",
    attempt: 1,
    fixCycle: state.fixCycles,
    previousAttemptSessionId: null,
    lastCodeSessionId: state.lastCodeSessionId,
    ...(verificationReport ? { verificationReport } : {}),
  });
}
