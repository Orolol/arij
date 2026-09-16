"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** One write at a time per mounted resource, with no stale UI completion. */
export function useScopedMutation(key: string | null) {
  const scope = useMemo(() => ({ key }), [key]);
  const active = useRef<typeof scope | null>(scope);
  const pending = useRef(new Map<string, Set<string>>());
  const [byKey, setByKey] = useState({ scope, pendingKeys: [] as string[], errors: {} as Record<string, string | undefined> });
  const [state, setState] = useState({ scope, pending: false, error: null as string | null });

  useEffect(() => {
    active.current = scope;
    return () => { active.current = null; };
  }, [scope]);

  const run = useCallback(async <T,>(operation: () => Promise<T>, fallback: string, subKey = "default"): Promise<T | null> => {
    if (!key || active.current !== scope || pending.current.get(key ?? "")?.has(subKey)) return null;
    const keys = pending.current.get(key ?? "") ?? new Set<string>();
    keys.add(subKey);
    pending.current.set(key, keys);
    setByKey((previous) => ({ scope, pendingKeys: [...keys], errors: { ...(previous.scope === scope ? previous.errors : {}), [subKey]: undefined } }));
    setState({ scope, pending: true, error: null });
    const invoke = async () => operation();
    const outcome = await invoke().then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error: error instanceof Error ? error.message : fallback }),
    );
    keys.delete(subKey);
    if (!keys.size) pending.current.delete(key);
    if (active.current !== scope) return null;
    setState({ scope, pending: keys.size > 0, error: outcome.error });
    setByKey((previous) => ({ scope, pendingKeys: [...keys], errors: { ...(previous.scope === scope ? previous.errors : {}), [subKey]: outcome.error ?? undefined } }));
    return outcome.value;
  }, [key, scope]);

  const clearError = useCallback(() => {
    if (active.current !== scope) return;
    setState((current) => current.scope === scope ? { ...current, error: null } : current);
  }, [scope]);

  return {
    run,
    pendingKeys: byKey.scope === scope ? byKey.pendingKeys : [],
    errors: byKey.scope === scope ? byKey.errors : {},
    pending: state.scope === scope && state.pending,
    error: state.scope === scope ? state.error : null,
    clearError,
  };
}
