import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import {
  isSessionLifecycleConflictError,
  markSessionCancelled,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";

/**
 * Reason string persisted on sessions cancelled by the boot sweep.
 * Surfaced verbatim in the sessions UI, so keep it human-readable.
 */
export const ORPHANED_BY_RESTART_REASON = "orphaned by restart";

/**
 * Cancels agent sessions left in 'queued' by a dead server process.
 *
 * Queued sessions only exist as launch closures inside the in-process
 * agent scheduler (lib/agents/scheduler.ts); when the process dies, those
 * closures die with it and the DB rows can never start. This sweep runs at
 * boot — from instrumentation.ts, right after the database is ready and
 * before any request can enqueue new work — so every 'queued' row it sees
 * is provably orphaned.
 *
 * Uses the lifecycle transition functions (queued -> cancelled is a legal
 * transition), never raw status updates. Returns the number of sessions
 * cancelled.
 */
export function cancelOrphanedQueuedSessions(): number {
  const orphans = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(eq(agentSessions.status, "queued"))
    .all();

  let cancelled = 0;
  for (const orphan of orphans) {
    try {
      markSessionCancelled(orphan.id, ORPHANED_BY_RESTART_REASON);
      cancelled++;
    } catch (error) {
      // A concurrent transition here would be surprising (we run before any
      // request), but a single bad row must not abort the whole sweep.
      if (!isSessionLifecycleConflictError(error)) {
        console.error(
          `[boot-cleanup] Failed to cancel orphaned session ${orphan.id}`,
          error
        );
      }
    }
  }

  if (cancelled > 0) {
    console.log(
      `[boot-cleanup] Cancelled ${cancelled} queued session(s) orphaned by restart`
    );
  }

  return cancelled;
}

/**
 * Fails agent sessions left in 'running' by a dead server process.
 *
 * CLI children are child processes of the server: when the server dies they
 * die with it, so at boot any 'running' row is provably a zombie — it can
 * never produce chunks again, and the watchdog would flag it as stalled
 * forever. Mark them failed (outcome 'error') so the UI tells the truth.
 */
export function failOrphanedRunningSessions(): number {
  const zombies = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(eq(agentSessions.status, "running"))
    .all();

  let failed = 0;
  for (const zombie of zombies) {
    try {
      markSessionTerminal(zombie.id, {
        success: false,
        error: ORPHANED_BY_RESTART_REASON,
        outcome: "error",
      });
      failed++;
    } catch (error) {
      if (!isSessionLifecycleConflictError(error)) {
        console.error(
          `[boot-cleanup] Failed to mark zombie session ${zombie.id}`,
          error
        );
      }
    }
  }

  if (failed > 0) {
    console.log(
      `[boot-cleanup] Failed ${failed} running session(s) orphaned by restart`
    );
  }

  return failed;
}
