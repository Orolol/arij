"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePolling } from "@/hooks/usePolling";

/**
 * Keep one read per session resource in flight. A terminal transition queues
 * one final read behind any pending poll, and leaving the resource cancels it.
 * Callers must check the signal before publishing their response.
 */
export function useSessionPolling(
  key: string,
  load: (signal: AbortSignal) => Promise<void>,
  isRunning: boolean,
  intervalMs: number,
  { immediate = false, enabled = true }: { immediate?: boolean; enabled?: boolean } = {},
) {
  const loader = useRef(load);
  const active = useRef<{
    key: string;
    controller: AbortController;
    pending: Promise<void> | null;
    queued: boolean;
  } | null>(null);

  useEffect(() => { loader.current = load; }, [load]);
  useEffect(() => {
    const resource = { key, controller: new AbortController(), pending: null, queued: false };
    active.current = resource;
    return () => { resource.controller.abort(); };
  }, [key]);

  const read = useCallback(async (queue: boolean) => {
    const resource = active.current;
    if (!resource || resource.key !== key || resource.controller.signal.aborted) return;
    if (resource.pending) {
      if (queue) resource.queued = true;
      return resource.pending;
    }
    resource.pending = (async () => {
      do {
        resource.queued = false;
        try {
          await loader.current(resource.controller.signal);
        } catch {
          // Loaders report their own errors. A rejected periodic read must
          // still leave the queued completion read a chance to recover.
        }
      } while (resource.queued && !resource.controller.signal.aborted);
    })();
    await resource.pending;
    resource.pending = null;
  }, [key]);

  const refresh = useCallback(() => read(false), [read]);
  useEffect(() => {
    if (immediate && enabled) void refresh();
  }, [refresh, immediate, enabled]);
  usePolling(refresh, intervalMs, isRunning && enabled, { immediate: false });

  const previous = useRef({ key, isRunning });
  useEffect(() => {
    if (previous.current.key === key && previous.current.isRunning && !isRunning && enabled) {
      void read(true);
    }
    previous.current = { key, isRunning };
  }, [key, isRunning, enabled, read]);

  return refresh;
}
