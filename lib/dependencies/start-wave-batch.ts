import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { logTransition } from "@/lib/workflow/log";
import { eq } from "drizzle-orm";
import { runExecutionWaves, type RunExecutionWavesOptions, type WaveSkippedTicket } from "./wave-runner";

/** Shared durable wave callbacks and nonblocking first-wave response. */
export function startWaveBatch(input: RunExecutionWavesOptions & { projectId: string }) {
  const { projectId, plan } = input;
  const skipReason = (skip: WaveSkippedTicket): string => {
    if (skip.kind === "aborted") {
      // markSkipped stored the abort reason verbatim.
      return plan.failureReasons.get(skip.epicId) ?? "batch aborted";
    }
    if (skip.kind === "stopped") {
      return `skipped: batch stopped after wave ${skip.wave} failure`;
    }
    const blocker = skip.blockedById
      ? db
          .select({ readableId: epics.readableId, title: epics.title })
          .from(epics)
          .where(eq(epics.id, skip.blockedById))
          .get()
      : null;
    const ref =
      blocker?.readableId || blocker?.title || skip.blockedById || "unknown";
    return skip.kind === "failed"
      ? `skipped: dependency ${ref} failed`
      : `skipped: dependency ${ref} asked a question`;
  };


  let resolveFirstWave!: (ids: string[]) => void;
  let resolved = false;
  const firstWaveLaunched = new Promise<string[]>((resolve) => { resolveFirstWave = resolve; });
  const settleFirstWave = (ids: string[]) => { if (!resolved) { resolved = true; resolveFirstWave(ids); } };
  const engineDone = runExecutionWaves({ ...input, callbacks: {
    ...input.callbacks,
    onWaveLaunched: (wave, ids) => { settleFirstWave(ids); input.callbacks?.onWaveLaunched?.(wave, ids); },
      onSkip: (skip) => {
        input.callbacks?.onSkip?.(skip);
        // The skipped ticket never moves — log the decision so the board
        // history answers "why didn't this build?".
        try {
          const held = db
            .select({ status: epics.status })
            .from(epics)
            .where(eq(epics.id, skip.epicId))
            .get();
          const heldStatus = held?.status ?? "backlog";
          logTransition({
            projectId,
            epicId: skip.epicId,
            fromStatus: heldStatus,
            toStatus: heldStatus,
            actor: "system",
            reason: skipReason(skip),
            sessionId: skip.blockedBySessionId ?? undefined,
          });
        } catch (error) {
          console.warn(
            `[wave] Failed to log skip for epic ${skip.epicId}`,
            error
          );
        }
      },
  }}).finally(() => settleFirstWave([]));
  return { firstWaveLaunched, engineDone };
}
