import type { ChildProcess } from "child_process";

export const DEFAULT_SIGKILL_TIMEOUT_MS = 5000;

/**
 * Whether the child process handle itself is still running.
 *
 * NOT `child.killed`, which only reports that a signal was successfully
 * delivered — it flips to true the instant `kill()` returns and says nothing
 * about whether the process died. A process still holds the CPU until one of
 * `exitCode` / `signalCode` is set.
 */
export function isChildAlive(child: ChildProcess): boolean {
  const exited = child.exitCode !== null && child.exitCode !== undefined;
  const signalled = child.signalCode !== null && child.signalCode !== undefined;
  return !exited && !signalled;
}

/**
 * Checks whether an owned process group is still alive on POSIX systems.
 *
 * Probes with signal 0 (`process.kill(-pgid, 0)`).
 * Returns true if at least one process in the group is still alive.
 * Returns false if pgid <= 0, on Windows, or if error is ESRCH.
 */
export function isProcessGroupAlive(pgid: number | null | undefined): boolean {
  if (!pgid || pgid <= 0) return false;
  if (process.platform === "win32") return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error?.code === "EPERM") return true;
    return false;
  }
}

/**
 * Whether the child process or its process group is still alive.
 *
 * A detached child creates a process group with PGID equal to its PID.
 * Even after the leader process exits on SIGTERM, its descendants can survive
 * in the same process group.
 */
export function isChildOrGroupAlive(
  child: ChildProcess | null | undefined,
  pgid?: number | null
): boolean {
  if (child && isChildAlive(child)) return true;
  const targetPgid = pgid ?? (child?.pid && child.pid > 0 ? child.pid : null);
  if (targetPgid) {
    return isProcessGroupAlive(targetPgid);
  }
  return false;
}

/**
 * Signals a process group with negative PID, with platform and error handling.
 */
export function signalProcessGroup(
  pgid: number,
  signal: "SIGTERM" | "SIGKILL"
): boolean {
  if (pgid <= 0) return false;
  if (process.platform === "win32") {
    try {
      process.kill(pgid, signal);
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error?.code === "ESRCH") return false;
    try {
      process.kill(pgid, signal);
      return true;
    } catch {
      return false;
    }
  }
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
  child: ChildProcess | null | undefined,
  signal: "SIGTERM" | "SIGKILL",
  fallbackPgid?: number | null
): void {
  const pgid =
    (child?.pid && child.pid > 0 ? child.pid : null) ?? fallbackPgid ?? null;
  if (!pgid || pgid <= 0) return;

  const childAlive = child ? isChildAlive(child) : false;
  const groupAlive = childAlive ? true : isProcessGroupAlive(pgid);
  if (!childAlive && !groupAlive) return;

  try {
    process.kill(-pgid, signal);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    // ESRCH on the GROUP while the child handle is still alive means the pid
    // is not a group leader (a spawn without `detached`, or a group already
    // torn down around a still-running leader): signal the child itself.
    // ESRCH with a dead handle means everything is already gone.
    if (error?.code === "ESRCH" && !childAlive) return;
    try {
      if (child) {
        child.kill(signal);
      } else {
        process.kill(pgid, signal);
      }
    } catch {
      // Already reaped — nothing left to signal.
    }
  }
}

export interface ChildKiller {
  kill: () => void;
  isKilled: () => boolean;
  clear: () => void;
  waitForTeardown: (timeoutMs?: number) => Promise<boolean>;
  isTeardownComplete: () => boolean;
}

/**
 * Creates a cancellation helper with SIGTERM-to-SIGKILL escalation.
 *
 * Shared between spawnClaude, spawnClaudeStream, and BaseCliProvider so that
 * all CLI agents follow identical cancellation semantics:
 * 1. Initial kill sends SIGTERM to the process group.
 * 2. If the process group or leader is still alive after graceMs, escalates to SIGKILL to the group.
 * 3. Tracks process group survival independently of leader exit: descendants ignoring SIGTERM
 *    are still escalated to SIGKILL even if the leader already exited.
 * 4. Completion and worktree reuse await full group teardown.
 */
export function createChildKiller(
  getChild: () => ChildProcess | null,
  graceMs: number = DEFAULT_SIGKILL_TIMEOUT_MS
): ChildKiller {
  let killed = false;
  let timer: NodeJS.Timeout | null = null;
  let cachedPgid: number | null = null;

  const getPgid = (): number | null => {
    const child = getChild();
    if (child?.pid && child.pid > 0) {
      cachedPgid = child.pid;
    }
    return cachedPgid;
  };

  const isGroupOrChildAlive = (): boolean => {
    const child = getChild();
    const pgid = getPgid();
    return isChildOrGroupAlive(child, pgid);
  };

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const kill = () => {
    const child = getChild();
    const pgid = getPgid();
    if (!isChildOrGroupAlive(child, pgid)) return;
    if (killed) return;
    killed = true;

    signalChild(child, "SIGTERM", pgid);

    timer = setTimeout(() => {
      const currentChild = getChild();
      const currentPgid = getPgid();
      if (isChildOrGroupAlive(currentChild, currentPgid)) {
        signalChild(currentChild, "SIGKILL", currentPgid);
      }
    }, graceMs);
    timer.unref?.();
  };

  const isKilled = () => killed;

  const isTeardownComplete = () => {
    return !isGroupOrChildAlive();
  };

  const waitForTeardown = async (
    timeoutMs: number = graceMs + 3000
  ): Promise<boolean> => {
    if (!isGroupOrChildAlive()) {
      clear();
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!isGroupOrChildAlive()) {
        clear();
        return true;
      }
      if (Date.now() - start >= graceMs) {
        const currentChild = getChild();
        const currentPgid = getPgid();
        if (isChildOrGroupAlive(currentChild, currentPgid)) {
          signalChild(currentChild, "SIGKILL", currentPgid);
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    const done = !isGroupOrChildAlive();
    if (done) clear();
    return done;
  };

  return { kill, isKilled, clear, waitForTeardown, isTeardownComplete };
}
