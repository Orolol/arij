/**
 * Next.js instrumentation hook — runs once when the server boots
 * (dev and production). Applies pending database migrations and seeds
 * before any request is served.
 *
 * API routes remain safe even if a route module loads before this runs
 * (or in environments that skip instrumentation): lib/db initializes
 * lazily on first use. This hook just front-loads that work to startup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDbReady } = await import("@/lib/db");
    ensureDbReady();
  }
}
