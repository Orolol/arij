import type { VerificationResult } from "@/lib/verify/runner";
import { PIPELINE_REASONS } from "./constants";
import type { PipelineTerminalSummary } from "./runner";
import type { PipelineRunContext } from "./runner-context";
import { dispatchStage } from "./runner-dispatch";

/**
 * Deterministic verification step of the code stage.
 *
 * Arij-owned test/lint/build commands run after every successful code stage
 * (RunPipelineOptions.runDeterministicVerification). Reports are plain
 * persisted records, never agent sessions, so this step cannot consume the
 * session ceiling. A failing command spends one fix cycle carrying the exact
 * failed command; an exhausted budget or a crashed driver parks the ticket
 * and fails the run.
 */
export type DeterministicVerificationStep =
  | { kind: "terminal"; summary: PipelineTerminalSummary }
  | { kind: "dispatched" }
  | {
      kind: "proceed";
      /** The passing report, when configured checks ran and passed. */
      verificationReport: VerificationResult | undefined;
    };

export async function runDeterministicVerificationStep(
  ctx: PipelineRunContext
): Promise<DeterministicVerificationStep> {
  const { options, callbacks, state } = ctx;

  let verificationReport: VerificationResult | undefined;
  try {
    if (options.runDeterministicVerification) {
      const verification = await options.runDeterministicVerification(
        state.lastCodeSessionId
      );
      if (verification.ran) {
        if (!verification.result) {
          throw new Error("Verification ran without producing a report");
        }

        if (verification.result.status === "pass") {
          verificationReport = verification.result;
          callbacks.onTrace?.(
            PIPELINE_REASONS.deterministicVerificationPassed(
              verification.result.commands.length
            ),
            state.handle.sessionId
          );
        } else {
          const failedCommand =
            verification.result.commands.find(
              (command) => command.exitCode !== 0
            ) ?? verification.result.commands.at(-1);
          if (!failedCommand) {
            throw new Error(
              "Failed verification report contains no command result"
            );
          }

          callbacks.onTrace?.(
            PIPELINE_REASONS.deterministicVerificationFailed(
              failedCommand.name
            ),
            state.handle.sessionId
          );

          if (state.fixCycles >= options.maxFixCycles) {
            callbacks.onTrace?.(
              PIPELINE_REASONS.failedDeterministicVerification(
                state.fixCycles
              ),
              state.handle.sessionId
            );
            try {
              options.parkRejectedTicket?.(
                state.lastCodeSessionId,
                "Deterministic verification rejected the branch"
              );
            } catch (parkError) {
              console.warn(
                "[pipeline] Failed to park verification-rejected ticket:",
                parkError instanceof Error ? parkError.message : parkError
              );
            }
            return {
              kind: "terminal",
              summary: ctx.finish(
                "failed",
                `deterministic verification still failing after ${state.fixCycles} fix cycles`
              ),
            };
          }

          state.fixCycles += 1;
          const summary = await dispatchStage(ctx, {
            stage: "fix",
            fixCycle: state.fixCycles,
            attempt: 1,
            previousAttemptSessionId: null,
            lastCodeSessionId: state.lastCodeSessionId,
            verificationFailure: { kind: "command", command: failedCommand },
          });
          return summary ? { kind: "terminal", summary } : { kind: "dispatched" };
        }
      } else if (verification.skipReason) {
        callbacks.onTrace?.(
          PIPELINE_REASONS.deterministicVerificationSkipped(
            verification.skipReason
          ),
          state.handle.sessionId
        );
      }
    }
  } catch (error) {
    console.warn(
      "[pipeline] Deterministic verification crashed:",
      error instanceof Error ? error.message : error
    );
    callbacks.onTrace?.(
      PIPELINE_REASONS.failedDeterministicVerificationCrashed,
      state.handle.sessionId
    );
    try {
      options.parkRejectedTicket?.(
        state.lastCodeSessionId,
        "Deterministic verification crashed before it could verify the branch"
      );
    } catch (parkError) {
      console.warn(
        "[pipeline] Failed to park verification-crashed ticket:",
        parkError instanceof Error ? parkError.message : parkError
      );
    }
    return {
      kind: "terminal",
      summary: ctx.finish("failed", "deterministic verification crashed"),
    };
  }

  return { kind: "proceed", verificationReport };
}
