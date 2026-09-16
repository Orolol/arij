"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { requestJson } from "@/lib/api/client";

/**
 * Poll a JSON { data } resource, retaining the last good snapshot on failure.
 * Responses are ordered by request; refresh invalidates every read issued
 * before a confirmed mutation so a slow poll cannot undo the visible result.
 * Pass a null interval for a single read, or pollWhen to stop polling a
 * settled resource. Validators and error formatters should have stable identities.
 */
export function usePolledResource<T>(
  url: string | null,
  intervalMs: number | null | ((data: T | null) => number | null),
  errorMessage: (status?: number) => string,
  { validateData, pollWhen, cancelPrevious = false }: {
    validateData?: (value: unknown) => value is T;
    pollWhen?: (data: T | null) => boolean;
    cancelPrevious?: boolean;
  } = {},
) {
  const scope = useMemo(() => ({ url }), [url]);
  const [state, setState] = useState<{
    scope: typeof scope;
    data: T | null;
    loading: boolean;
    error: string | null;
  }>({ scope, data: null, loading: true, error: null });
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeScope = useRef<typeof scope | null>(scope);

  useEffect(() => {
    activeScope.current = scope;
    // Also invalidate reads from the previous URL or a discarded StrictMode
    // effect, and prevent completions after unmount from publishing state.
    generation.current += 1;
    return () => {
      generation.current += 1;
      controller.current?.abort();
      activeScope.current = null;
    };
  }, [scope]);

  const load = useCallback(async (requestUrl = url) => {
    if (!url || activeScope.current !== scope) return false;
    const request = ++requestSeq.current;
    const issuedGeneration = generation.current;
    let signal: AbortSignal | undefined;
    if (cancelPrevious) {
      controller.current?.abort();
      controller.current = new AbortController();
      signal = controller.current.signal;
    }
    const { data, error } = await requestJson<T>(requestUrl!, { errorMessage, validateData, ...(signal ? { signal } : {}) });
    if (signal?.aborted || issuedGeneration !== generation.current || request <= appliedSeq.current) return false;
    appliedSeq.current = request;
    setState((previous) => ({
      scope,
      data: error ? (previous.scope === scope ? previous.data : null) : data,
      loading: false,
      error,
    }));
    return !error;
  }, [url, scope, errorMessage, validateData, cancelPrevious]);

  const reload = useCallback(async (requestUrl?: string) => {
    if (!url || activeScope.current !== scope) return;
    generation.current += 1;
    setState((previous) => ({
      scope,
      data: previous.scope === scope ? previous.data : null,
      loading: true,
      error: null,
    }));
    return await load(requestUrl);
  }, [load, url, scope]);
  const refresh = useCallback(async () => { await reload(); }, [reload]);

  // A confirmed write owns the new snapshot. Neither a preceding read nor a
  // mutation from an earlier visit to the same URL may replace it afterwards.
  const updateData = useCallback((change: T | ((previous: T | null) => T)) => {
    if (!url || activeScope.current !== scope) return;
    generation.current += 1;
    setState((previous) => ({
      scope,
      data: typeof change === "function"
        ? (change as (previous: T | null) => T)(previous.scope === scope ? previous.data : null)
        : change,
      loading: false,
      error: null,
    }));
  }, [url, scope]);

  const data = state.scope === scope && url ? state.data : null;
  // Initial reads do not depend on whether the returned resource is live.
  // A completed report stops its timer without triggering another initial read.
  const poll = useCallback(async () => { await load(); }, [load]);
  usePolling(poll, null, Boolean(url));
  const cadence = typeof intervalMs === "function" ? intervalMs(data) : intervalMs;
  usePolling(poll, cadence, Boolean(url) && cadence !== null && (!pollWhen || pollWhen(data)), { immediate: false });

  return {
    data,
    loading: Boolean(url) && (state.scope !== scope || state.loading),
    error: state.scope === scope && url ? state.error : null,
    refresh,
    reload,
    updateData,
  };
}
