import {
  processManager,
  type SessionInfo,
} from "@/lib/claude/process-manager";

/**
 * Poll cadence shared by every route that waits on a spawned CLI. The QA
 * check route historically used the same 2s; the releases route polls
 * faster (1.2s) and passes its own interval.
 */
export const DEFAULT_COMPLETION_POLL_INTERVAL_MS = 2000;

/**
 * Waits until the process manager reports a session as no longer running,
 * then returns its final SessionInfo (result included).
 *
 * Extracted verbatim from the launch closures in the build, review, and
 * merge routes (and their siblings), which each hand-rolled:
 *
 *   let info = processManager.getStatus(sessionId);
 *   while (info && info.status === "running") {
 *     await new Promise((r) => setTimeout(r, 2000));
 *     info = processManager.getStatus(sessionId);
 *   }
 *
 * Exact semantics preserved:
 *   - No timeout: the loop runs as long as the session reports 'running'.
 *     A crashed spawn settles the tracked status to 'failed' (see
 *     process-manager), so the loop terminates with the failure result.
 *   - Returns null when the session was never tracked (or was removed) —
 *     callers read `info?.result` exactly as before.
 *   - The first check is synchronous: an already-finished session never
 *     sleeps.
 */
export async function waitForProcessCompletion(
  sessionId: string,
  pollIntervalMs: number = DEFAULT_COMPLETION_POLL_INTERVAL_MS,
  graceMs?: number,
): Promise<SessionInfo | null> {
  let info = processManager.getStatus(sessionId);
  while (info && info.status === "running") {
    const closePromise = processManager.getClosePromise?.(sessionId);
    if (closePromise) {
      await Promise.race([
        closePromise,
        new Promise((r) => setTimeout(r, pollIntervalMs)),
      ]);
    } else {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    info = processManager.getStatus(sessionId);
  }

  // Once the session is no longer running (e.g. cancelled, failed, or completed),
  // wait for the underlying child process to actually close (or bounded grace)
  // before returning to the caller. This ensures worktree slots are not reused
  // while the cancelled process could still be writing to disk.
  if (info && typeof processManager.waitForClose === "function") {
    await processManager.waitForClose(sessionId, graceMs);
    info = processManager.getStatus(sessionId);
  }

  return info;
}
