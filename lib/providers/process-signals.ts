import type { ChildProcess } from "child_process";

export const DEFAULT_SIGKILL_TIMEOUT_MS = 5000;

/**
 * Whether the child is still running.
 *
 * NOT `child.killed`, which only reports that a signal was successfully
 * delivered — it flips to true the instant `kill()` returns and says nothing
 * about whether the process died. A process still holds the CPU until one of
 * `exitCode` / `signalCode` is set.
 */
export function isChildAlive(child: ChildProcess): boolean {
  // Only an explicitly-set exit field proves death. Anything else — including
  // a handle that does not report these at all — is treated as alive, because
  // on a kill path a redundant signal costs nothing and a skipped one leaves
  // an agent running loose.
  const exited = child.exitCode !== null && child.exitCode !== undefined;
  const signalled = child.signalCode !== null && child.signalCode !== undefined;
  return !exited && !signalled;
}

/**
 * Signals the child's whole process GROUP, falling back to the child alone.
 *
 * A CLI agent is a tree, not a process: it spawns shells, test runners and
 * dev servers of its own. Signalling only the process at the head leaves that
 * tree running, re-parented to init and invisible to Arij — the concrete
 * symptom being a dev server still bound to a port hours after the session
 * that started it was cancelled.
 *
 * `-pid` addresses the group, which exists because the spawn is `detached`.
 * Never signals if pid <= 0 or undefined (protects the orchestrator and PID 1).
 * ESRCH simply means everything is already gone.
 */
export function signalChild(
  child: ChildProcess,
  signal: "SIGTERM" | "SIGKILL"
): void {
  if (!isChildAlive(child)) return;
  if (!child.pid || child.pid <= 0) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already reaped — nothing left to signal.
    }
  }
}

export interface ChildKiller {
  kill: () => void;
  isKilled: () => boolean;
  clear: () => void;
}

/**
 * Creates a cancellation helper with SIGTERM-to-SIGKILL escalation.
 *
 * Shared between spawnClaude, spawnClaudeStream, and BaseCliProvider so that
 * all CLI agents follow identical cancellation semantics:
 * 1. Initial kill sends SIGTERM to the process group.
 * 2. If the process is still alive after graceMs, escalates to SIGKILL to the group.
 * 3. Repeated calls are safe no-ops.
 * 4. Cleanup clears the escalation timer once the process exits.
 */
export function createChildKiller(
  getChild: () => ChildProcess | null,
  graceMs: number = DEFAULT_SIGKILL_TIMEOUT_MS
): ChildKiller {
  let killed = false;
  let timer: NodeJS.Timeout | null = null;

  const kill = () => {
    const child = getChild();
    if (!child || !isChildAlive(child)) return;
    if (killed) return;
    killed = true;

    signalChild(child, "SIGTERM");

    timer = setTimeout(() => {
      const currentChild = getChild();
      if (currentChild && isChildAlive(currentChild)) {
        signalChild(currentChild, "SIGKILL");
      }
    }, graceMs);
    timer.unref?.();
  };

  const isKilled = () => killed;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { kill, isKilled, clear };
}
