/**
 * Waiting for background work, once, with one policy.
 *
 * THE PROBLEM THIS REPLACES. Fourteen test files used to define their own
 * `flushBackground()`: two or more real `setTimeout` hops (25 ms, 50 ms, up to
 * 100+100 ms) and then assertions. 113 calls, 7.6 s of sleeping, and a hidden
 * assumption — "half a second is long enough for the dispatch to have written"
 * — that is the same bet that produced the `refinement-button` flake. Under
 * load the bet loses, and the failure reads as a product bug.
 *
 * THE TWO CORRECT ANSWERS, in order of preference:
 *
 *  1. AWAIT THE WORK. Every dispatcher in this codebase returns (or now
 *     returns) a `settled` promise that resolves after its terminal hook has
 *     run and never rejects — `dispatchBackgroundSession` is the root of that
 *     chain. Prefer it: it is exact, immediate, and says what the test means.
 *     `await dispatched.settled` costs nothing when the work is already done.
 *
 *  2. POLL THE OBSERVABLE EFFECT. When the work was started by something that
 *     cannot hand back a promise — a route's fire-and-forget closure, the
 *     scheduler's safety net — wait for the STATE the test is about to assert
 *     (`waitForBackground(() => expect(row.status).toBe("failed"), …)`).
 *     That is what this helper is for: `vi.waitFor` retries the assertion
 *     until it holds, so the test proceeds the moment the effect lands and
 *     fails with the assertion's own message when it never does.
 *
 * WHAT NOT TO DO. Never add a bare sleep back. If neither answer applies, the
 * effect is not observable and the test is asserting nothing — fix the test,
 * not the delay.
 */

import { vi } from "vitest";

/**
 * Waits until a session row leaves `running`.
 *
 * The commonest observable in the route tests: the route returns as soon as
 * the row exists and its completion closure finishes later. Prefer
 * `await dispatched.settled` where a handle exists; this is for the routes
 * that hand back only an id.
 *
 * NOT usable for a run that is meant to stay `running` (a test that makes the
 * terminal write fail on purpose) — wait on that run's own side effect.
 */
export async function waitForSessionTerminal(
  sessionId: string,
  label = "the session reaching a terminal state",
): Promise<void> {
  const { db } = await import("@/lib/db");
  const { agentSessions } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  await waitForBackground(
    () =>
      expect(
        db
          .select({ status: agentSessions.status })
          .from(agentSessions)
          .where(eq(agentSessions.id, sessionId))
          .get()?.status,
      ).not.toBe("running"),
    label,
  );
}

/**
 * Retries `effect` until it stops throwing, or fails the test.
 *
 * @param effect the assertion(s) that prove the background work landed. Must
 *   be synchronous or return a promise; a bare `expect` works, and the last
 *   computed value is returned so a caller can assert AND read in one wait.
 *   Pass the WHOLE run of assertions a test makes about one background
 *   effect, not just its first: a later stage of the same closure (a summary
 *   notification, a second write) lags the first, and waiting on the first
 *   alone leaves the rest racy again.
 * @param label what is being waited for, quoted in the timeout message — the
 *   default "background work" tells the next person nothing.
 */
export async function waitForBackground<T>(
  effect: () => T | Promise<T>,
  label: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  let value!: T;
  await vi.waitFor(
    async () => {
      try {
        value = await effect();
      } catch (error) {
        // Re-thrown with the label so a timeout says WHAT never happened
        // rather than printing an assertion about a row the reader cannot
        // place.
        throw new Error(
          `${label} — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    {
      // Longer than any legitimate effect in this suite (the slowest verified
      // dispatch settles in tens of milliseconds), short enough that a real
      // hang fails rather than stalling the run.
      timeout: options.timeoutMs ?? 5_000,
      interval: options.intervalMs ?? 5,
    },
  );
  return value;
}
