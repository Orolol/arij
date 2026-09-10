import fs from "fs";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { resolveVerifyConfigForProject } from "@/lib/verify/config";
import type { VerifyConfig } from "@/lib/verify/verify-constants";
import { withVerificationWorktreeLock } from "@/lib/verify/execution-lock";
import { runVerification as executeVerification } from "@/lib/verify/runner";
import { assertManagedEpicWorktreePath } from "@/lib/verify/worktree";
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
  // nothing about the branch (mirroring lib/pipeline/verify.ts), while a
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

  let plan: {
    worktreePath: string;
    commands: VerifyConfig["commands"];
    timeoutMs: number;
  } | null = null;
  try {
    const config = resolveVerifyConfigForProject(init.projectId);
    if (!config.enabled) return notRun();
    if (!lastCodeSessionId) {
      return skip("deterministic verification requires a code session");
    }

    const codeSession = db
      .select({ worktreePath: agentSessions.worktreePath })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.id, lastCodeSessionId),
          eq(agentSessions.projectId, init.projectId),
          eq(agentSessions.epicId, init.epicId)
        )
      )
      .get();
    if (!codeSession?.worktreePath) {
      return skip("no epic worktree recorded by the last code session");
    }
    const worktreePath = codeSession.worktreePath;

    const project = db
      .select({ gitRepoPath: projects.gitRepoPath })
      .from(projects)
      .where(eq(projects.id, init.projectId))
      .get();
    if (!project?.gitRepoPath) {
      return skip("deterministic verification requires a Git repository");
    }
    // Hard constraint: never execute in the repository checkout or any
    // unmanaged path, even when durable session state records one.
    assertManagedEpicWorktreePath(worktreePath, project.gitRepoPath);

    // A session row can outlive a worktree pruned after a merge. Spawning
    // into a missing cwd would surface as a spawn error — a phantom
    // "failing command" that burns a real fix cycle.
    if (!fs.existsSync(worktreePath)) {
      return skip(
        "the recorded epic worktree no longer exists on disk (pruned?)"
      );
    }

    plan = {
      worktreePath,
      commands: config.commands,
      timeoutMs: config.timeoutMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return skip(`applicability check failed: ${message}`);
  }

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
