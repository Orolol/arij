import path from "node:path";

/**
 * Serialises work on a single filesystem path.
 *
 * Clone is check-then-act — classify the destination, then create it — and two
 * imports of the same repository can interleave between those two steps. Both
 * see an absent destination, both clone, and the loser's failure handler tidies
 * up a directory the winner is already using.
 *
 * Scope is deliberately in-process: Arij is a single local Next.js server, and
 * a lock file would add crash-recovery problems (stale locks, liveness checks)
 * to solve a case that does not occur in this deployment.
 */

const chains = new Map<string, Promise<void>>();

/** Runs `task` with exclusive access to `rawKey`, queueing behind any current holder. */
export function withPathLock<T>(
  rawKey: string,
  task: () => Promise<T>
): Promise<T> {
  const key = path.resolve(rawKey);
  const previous = chains.get(key) ?? Promise.resolve();

  // `then(task, task)` so a rejected predecessor still releases the lock.
  const run = previous.then(task, task);

  // The queue tail must never reject, or every later waiter inherits the
  // failure. Callers still see the real outcome through `run`.
  const tail = run.then(
    () => {},
    () => {}
  );
  chains.set(key, tail);

  void tail.then(() => {
    // Only the current tail may clear the entry; a newer waiter owns it now.
    if (chains.get(key) === tail) chains.delete(key);
  });

  return run;
}
