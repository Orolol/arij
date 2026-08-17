/**
 * Next.js instrumentation hook — runs once when the server boots
 * (dev and production). Applies pending database migrations and seeds
 * before any request is served, then cancels agent sessions orphaned in
 * 'queued' by the previous process (their scheduler launch closures died
 * with it — see lib/agent-sessions/boot-cleanup.ts).
 *
 * API routes remain safe even if a route module loads before this runs
 * (or in environments that skip instrumentation): lib/db initializes
 * lazily on first use. This hook just front-loads that work to startup.
 *
 * Also starts the silent-session watchdog (lib/agents/watchdog.ts) — its
 * globalThis-backed singleton and idempotent start() make this safe under
 * dev hot reloads, which re-run instrumentation.
 *
 * Finally registers the session terminal hook
 * (lib/agent-sessions/terminal-hooks.ts): completed sessions are offered to
 * the memory auto-distillation trigger (lib/workflow/memory-distill.ts),
 * which is a no-op unless the 'memory_auto_distill' setting is on and its
 * guards pass. The hook slot is globalThis-backed and registration simply
 * replaces it, so hot reloads are safe here too.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDbReady } = await import("@/lib/db");
    ensureDbReady();

    const { cancelOrphanedQueuedSessions, failOrphanedRunningSessions } =
      await import("@/lib/agent-sessions/boot-cleanup");
    cancelOrphanedQueuedSessions();
    failOrphanedRunningSessions();

    const { startSessionWatchdog } = await import("@/lib/agents/watchdog");
    startSessionWatchdog();

    const { setSessionTerminalHook } = await import(
      "@/lib/agent-sessions/terminal-hooks"
    );
    const { maybeAutoDistillAfterSessionTerminal } = await import(
      "@/lib/workflow/memory-distill"
    );
    setSessionTerminalHook((event) => {
      if (event.status !== "completed") return;
      // Fire-and-forget: the trigger owns its guards and never rejects.
      void maybeAutoDistillAfterSessionTerminal(event.sessionId);
    });
  }
}
