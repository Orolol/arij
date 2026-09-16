"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

import { usePolledResource } from "@/hooks/usePolledResource";
import type { RegistrySort, RegistrySortDirection } from "@/lib/tickets-registry/sort";
import {
  REGISTRY_DONE_WINDOW,
  REGISTRY_RELEASED_WINDOW,
  REGISTRY_WINDOW_MAX,
  type RegistryGroup,
  type TicketsRegistryPayload,
} from "@/lib/tickets-registry/types";
import type { KanbanStatus } from "@/lib/types/kanban";

/**
 * The registry's single data source: one poll of `GET /api/tickets`.
 *
 * POLLING, NOT SSE, for the reason `hooks/useControlDesk.ts` documents at
 * length: `lib/events/bus.ts` has no wildcard room and only a per-project SSE
 * endpoint, so N EventSources would cost one long-lived HTTP/1.1 connection per
 * project and starve the page at about six. 10 s rather than the desk's 4 s —
 * the registry is a lookup surface, not an attention surface, and its query is
 * the heavier of the two.
 *
 * usePolledResource owns refresh generations and stale-response protection.
 */

const POLL_INTERVAL_MS = 10_000;

export interface TicketsRegistryWindow {
  done: number;
  released: number;
}

export interface UseTicketsRegistry {
  data: TicketsRegistryPayload | null;
  loading: boolean;
  error: string | null;
  window: TicketsRegistryWindow;
  refresh: () => Promise<void>;
  /** Raise the server window for one terminal group ("tout montrer ↓"). */
  setWindow: (group: RegistryGroup, limit: number) => void;
}

export function useTicketsRegistry(
  projectId?: string | null,
  query?: string,
  sort: RegistrySort = "activite",
  direction: RegistrySortDirection = "desc",
  status: KanbanStatus | "all" = "all",
): UseTicketsRegistry {
  const t = useTranslations("Registry");
  const [win, setWin] = useState<TicketsRegistryWindow>({
    done: REGISTRY_DONE_WINDOW,
    released: REGISTRY_RELEASED_WINDOW,
  });

  const href = useMemo(() => {
    const params = new URLSearchParams();
    params.set("sort", sort);
    params.set("direction", direction);
    if (status !== "all") params.set("status", status);
    if (projectId) params.set("project", projectId);
    const trimmed = (query ?? "").trim();
    if (trimmed) params.set("q", trimmed);
    if (win.done !== REGISTRY_DONE_WINDOW) params.set("doneLimit", String(win.done));
    if (win.released !== REGISTRY_RELEASED_WINDOW) {
      params.set("releasedLimit", String(win.released));
    }
    const search = params.toString();
    return search ? `/api/tickets?${search}` : "/api/tickets";
  }, [projectId, query, win.done, win.released, sort, direction, status]);

  const errorMessage = useCallback((status?: number) => status ? t("errors.loadFailedStatus", { status }) : t("errors.loadFailed"), [t]);
  const { data, loading, error, refresh } = usePolledResource<TicketsRegistryPayload>(href, POLL_INTERVAL_MS, errorMessage);

  const setWindow = useCallback((group: RegistryGroup, limit: number) => {
    const clamped = Math.min(REGISTRY_WINDOW_MAX, Math.max(1, Math.trunc(limit)));
    setWin((current) => {
      if (group === "done") {
        return clamped > current.done ? { ...current, done: clamped } : current;
      }
      if (group === "released") {
        return clamped > current.released ? { ...current, released: clamped } : current;
      }
      // The three open groups are never windowed — the route loads them whole.
      return current;
    });
  }, []);


  return { data, loading, error, window: win, refresh, setWindow };
}
