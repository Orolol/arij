import { planEpicVerification } from "@/lib/verify/plan";
import { withVerificationWorktreeLock } from "@/lib/verify/execution-lock";
import { runVerification as executeVerification } from "@/lib/verify/runner";
import { emitTicketUpdated } from "@/lib/events/emit";
import type { PipelineDeterministicVerificationOutcome } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";

/**
 * Deterministic verification driver: resolve the human-owned command list
 * for this invocation and run it only in the successful code session's
 * recorded epic worktree. There is no repository-checkout fallback: a
 * missing/mismatched worktree fails closed.
 */
export async function runPipelineVerification(
  init: PipelineStageDriverInit,
  lastCodeSessionId: string | null
): Promise<PipelineDeterministicVerificationOutcome> {
  // Applicability is decided by plain DB reads plus path checks. ONLY those
  // reads sit inside the try: the stage must be TOTAL for faults that say
  // nothing about the branch (mirroring lib/pipeline/regression-gate.ts), while a
  // genuine execution fault still reaches the runner's crash path. Every
  // non-disabled skip carries a reason: the runner traces it into
  // ticket_activity_log, because a silent skip would be indistinguishable
  // from "the configured checks passed".
  const notRun = (): PipelineDeterministicVerificationOutcome => ({
    ran: false,
    result: null,
  });
  const skip = (reason: string): PipelineDeterministicVerificationOutcome => {
    console.warn(`[pipeline verify] Skipping: ${reason}`);
    return { ran: false, result: null, skipReason: reason };
  };

  const planned = planEpicVerification(init.projectId, init.epicId, { codeSessionId: lastCodeSessionId });
  if (!planned.plan) return planned.reason ? skip(planned.reason) : notRun();
  const plan = planned.plan;

  // Deliberately OUTSIDE the applicability try: from here on a thrown fault
  // is an execution fault, and it belongs to the runner's crash path rather
  // than to a "skipped" trace.
  const result = await withVerificationWorktreeLock(
    plan.worktreePath,
    () =>
      executeVerification({
        projectId: init.projectId,
        epicId: init.epicId,
        agentSessionId: lastCodeSessionId,
        worktreePath: plan.worktreePath,
        commands: plan.commands,
        timeoutMs: plan.timeoutMs,
      })
  );

  // Persistence is tolerant by design (a lost row must not fail a run that
  // actually executed), but every durable reader — the merge gate, the
  // ticket overlay's VERIFICATION band, the next sweep — reads the table.
  // Announcing a verdict no reader can see would leave "verification passed"
  // in the feed next to a gate that says it never ran, so an unpersisted
  // report is a skip.
  if (!result.persisted) {
    return skip("the verification report could not be persisted");
  }

  // The manual route emits this too. Without it the board and the open
  // ticket overlay never learn that an autonomous run's checks have finished
  // (or failed) until the overlay is closed and reopened —
  // `useEpicDetail.fetchVerification` hangs off exactly this event.
  emitTicketUpdated(init.projectId, init.epicId, {
    verifyReportId: result.id,
    verifyStatus: result.status,
  });
  return { ran: true, result };
}
