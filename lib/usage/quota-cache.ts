import { fetchClaudeQuota } from "@/lib/usage/claude-quota";
import { fetchCodexLiveQuota } from "@/lib/usage/codex-appserver";
import { storeCodexLiveSnapshot } from "@/lib/usage/codex-snapshot";
import type { ClaudeQuota, CodexLiveQuota } from "@/lib/types/usage";

/**
 * In-process TTL cache in front of the two CLI quota pollers.
 *
 * Why it exists: `GET /api/usage` is the only trigger (no polling loops, by
 * contract), the page can be refreshed rapidly, and each poll costs a real
 * child-process spawn. Rules:
 *
 * - TTL 120s on the ATTEMPT, success or failure: a broken/missing CLI costs
 *   at most one spawn pair per TTL window, not one per page load.
 * - Concurrent requests share ONE in-flight promise per provider — no spawn
 *   stampede. `force` (?fresh=1) bypasses TTL but JOINS an existing flight;
 *   it never starts a second concurrent spawn.
 * - A failed poll clears `data` to null (straight to fallback) — half-stale
 *   live data is never shown as live.
 * - globalThis singleton via Symbol.for (dag-batch-registry pattern): a dev
 *   hot reload must not orphan an in-flight child process behind a fresh
 *   empty cache.
 *
 * Both getters NEVER reject — the fetchers already resolve null on every
 * failure path, and the route treats null as "render the fallback".
 */

export const QUOTA_TTL_MS = 120_000;

export interface CachedQuota<T> {
  data: T | null;               // last SUCCESSFUL poll's data, or null (fallback state)
  capturedAtIso: string | null; // wall clock of that successful poll; null when data null
}

interface CacheEntry<T> {
  lastAttemptAt: number | null;
  data: T | null;
  capturedAtIso: string | null;
  inFlight: Promise<CachedQuota<T>> | null;
}

interface QuotaCacheStore {
  claude: CacheEntry<ClaudeQuota>;
  codex: CacheEntry<CodexLiveQuota>;
}

function emptyEntry<T>(): CacheEntry<T> {
  return { lastAttemptAt: null, data: null, capturedAtIso: null, inFlight: null };
}

const QUOTA_CACHE_GLOBAL_KEY = Symbol.for("arij.usage-quota-cache");

function getStore(): QuotaCacheStore {
  const store = globalThis as { [QUOTA_CACHE_GLOBAL_KEY]?: QuotaCacheStore };
  if (!store[QUOTA_CACHE_GLOBAL_KEY]) {
    store[QUOTA_CACHE_GLOBAL_KEY] = {
      claude: emptyEntry<ClaudeQuota>(),
      codex: emptyEntry<CodexLiveQuota>(),
    };
  }
  return store[QUOTA_CACHE_GLOBAL_KEY];
}

function snapshotOf<T>(entry: CacheEntry<T>): CachedQuota<T> {
  return { data: entry.data, capturedAtIso: entry.capturedAtIso };
}

/**
 * Shared get-or-refresh: `poll` resolves the new data (null = failed poll)
 * and never rejects — but a defensive catch keeps the getter's never-reject
 * promise anyway.
 */
function getCached<T>(
  entry: CacheEntry<T>,
  force: boolean,
  poll: () => Promise<T | null>,
): Promise<CachedQuota<T>> {
  const fresh =
    entry.lastAttemptAt !== null &&
    Date.now() - entry.lastAttemptAt < QUOTA_TTL_MS;
  if (fresh && !force) return Promise.resolve(snapshotOf(entry));

  // force joins an existing flight — it must never start a second spawn.
  if (entry.inFlight) return entry.inFlight;

  const flight = (async (): Promise<CachedQuota<T>> => {
    let result: T | null = null;
    try {
      result = await poll();
    } catch {
      result = null; // fetchers resolve null on failure; this is belt-and-braces
    }
    entry.lastAttemptAt = Date.now(); // failures are TTL-cached too
    if (result !== null) {
      entry.data = result;
      entry.capturedAtIso = new Date().toISOString();
    } else {
      // Straight to fallback — never serve half-stale "live" data.
      entry.data = null;
      entry.capturedAtIso = null;
    }
    entry.inFlight = null;
    return snapshotOf(entry);
  })();

  entry.inFlight = flight;
  return flight;
}

export function getClaudeQuotaCached(
  force = false,
): Promise<CachedQuota<ClaudeQuota>> {
  return getCached(getStore().claude, force, () => fetchClaudeQuota());
}

export function getCodexQuotaCached(
  force = false,
): Promise<CachedQuota<CodexLiveQuota>> {
  return getCached(getStore().codex, force, async () => {
    const result = await fetchCodexLiveQuota();
    if (result === null) return null;
    // Persist every successful live poll so the rollout-fallback chain keeps
    // a single source of truth. Best-effort twice over: the function never
    // throws itself, and even if it did, a store failure must not void a
    // successful poll.
    try {
      storeCodexLiveSnapshot(result.quota, result.rawRateLimitsJson);
    } catch {
      // ignore — the live data is still good
    }
    return result.quota;
  });
}

/** Tests only — the globalThis store persists across tests within a worker. */
export function __resetQuotaCacheForTests(): void {
  const store = globalThis as { [QUOTA_CACHE_GLOBAL_KEY]?: QuotaCacheStore };
  store[QUOTA_CACHE_GLOBAL_KEY] = {
    claude: emptyEntry<ClaudeQuota>(),
    codex: emptyEntry<CodexLiveQuota>(),
  };
}
