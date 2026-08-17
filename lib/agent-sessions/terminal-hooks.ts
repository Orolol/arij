/**
 * Post-terminal session hook — a single, synchronously-invoked callback that
 * fires whenever a session row reaches a terminal status through
 * lib/agent-sessions/lifecycle.ts (markSessionTerminal, markSessionCancelled,
 * scheduler failure finalization, boot cleanup — every path funnels through
 * transitionSessionStatus).
 *
 * Deliberately a leaf module with no imports so lifecycle.ts can depend on it
 * without creating cycles (the hook implementation typically imports the
 * scheduler, which imports lifecycle).
 *
 * Registration happens at boot in instrumentation.ts. Nothing is registered
 * in unit tests unless a test opts in, so existing lifecycle-based suites see
 * zero behavior change.
 */

export interface SessionTerminalEvent {
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
}

export type SessionTerminalHook = (event: SessionTerminalEvent) => void;

/**
 * globalThis-backed hook slot (same pattern as the scheduler/watchdog
 * singletons): dev hot reloads re-evaluate module scope, and a module-local
 * slot would silently detach the boot-registered hook until instrumentation
 * re-runs. Every module generation reads/writes the same slot instead.
 */
const HOOK_GLOBAL_KEY = Symbol.for("arij.session-terminal-hook");

type HookGlobal = { [HOOK_GLOBAL_KEY]?: SessionTerminalHook | null };

/** Registers (or clears, with null) the process-wide terminal hook. */
export function setSessionTerminalHook(next: SessionTerminalHook | null): void {
  (globalThis as HookGlobal)[HOOK_GLOBAL_KEY] = next;
}

/**
 * Invokes the registered hook, if any. Never throws into the caller —
 * lifecycle transitions must not fail because a side effect did.
 */
export function notifySessionTerminal(event: SessionTerminalEvent): void {
  const hook = (globalThis as HookGlobal)[HOOK_GLOBAL_KEY];
  if (!hook) return;
  try {
    hook(event);
  } catch (err) {
    console.warn(
      "[terminal-hooks] Session terminal hook failed:",
      (err as Error).message
    );
  }
}
