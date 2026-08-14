"use client";

import { useEffect } from "react";

/**
 * Run `callback` every `intervalMs` while `enabled` is true.
 *
 * Replaces the repeated "useEffect(immediate call; setInterval; clearInterval)"
 * idiom. Semantics match the inlined version exactly:
 * - when polling (re)starts — on mount, when `enabled` flips to true, or when
 *   the memoized `callback` / `intervalMs` changes — the callback fires
 *   immediately, then on the interval;
 * - pass `{ immediate: false }` for call sites that only want the interval
 *   (e.g. an initial load already happens elsewhere);
 * - when `enabled` is false the interval is cleared and nothing runs.
 *
 * `callback` is an effect dependency: memoize it with useCallback, just like
 * the inlined idiom this replaces.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean = true,
  { immediate = true }: { immediate?: boolean } = {},
) {
  useEffect(() => {
    if (!enabled) return;
    if (immediate) void callback();
    const interval = setInterval(() => {
      void callback();
    }, intervalMs);
    return () => clearInterval(interval);
  }, [callback, intervalMs, enabled, immediate]);
}
