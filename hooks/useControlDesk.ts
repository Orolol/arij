"use client";

import { useTranslations } from "next-intl";

import { createContext, useCallback, useContext, useMemo } from "react";

import { usePolledResource } from "@/hooks/usePolledResource";
import type { ControlDeskPayload } from "@/lib/control-desk/types";

/**
 * The desk's single data source: one poll of `GET /api/control-desk`.
 *
 * POLLING, NOT SSE, and that is a decision rather than a shortcut.
 * `lib/events/bus.ts` keeps a `Map<projectId, Set<Listener>>` and `emit()`
 * returns early for a project with no listener; there is no wildcard room and
 * only a per-project SSE endpoint. Opening one EventSource per project works
 * but costs one long-lived HTTP/1.1 connection each, and browsers cap those at
 * about six per origin — so at six projects the desk's own polls would queue
 * behind its own streams. A wildcard room plus a single `GET /api/events` is
 * the follow-up; until then this replaces the 3s board / 5s inbox / 10s
 * dashboard polls with ONE request.
 *
 * @param projectId when set, the payload is narrowed to that project before it
 *                  reaches the desk — the `/projects/:id` route renders the
 *                  same desk, filtered.
 */
export function useControlDeskResource(enabled: boolean, intervalMs = 4000) {
  const tErrors = useTranslations("ClientErrors");
  const errorMessage = useCallback(
    (status?: number) => status === undefined
      ? tErrors("failedToLoadTheDesk")
      : tErrors("deskHttp", { status }),
    [tErrors],
  );
  const { data, loading, error, refresh } = usePolledResource<ControlDeskPayload>(
    enabled ? "/api/control-desk" : null, intervalMs, errorMessage,
  );

  return { data, loading, error, refresh, enabled };
}
const DeskContext = createContext<ReturnType<typeof useControlDeskResource> | null>(null);
export const ControlDeskContextProvider = DeskContext.Provider;
export function useDeskInboxSummary() {
  const shared = useContext(DeskContext);
  return { enabled: shared?.enabled ?? false, unreadCount: shared?.data?.inboxUnreadCount ?? 0 };
}

export function useControlDesk(
  projectId?: string | null,
  intervalMs = 4000,
): {
  data: ControlDeskPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const shared = useContext(DeskContext);
  const fallback = useControlDeskResource(!shared?.enabled, intervalMs);
  const { data, loading, error, refresh } = shared?.enabled ? shared : fallback;
  const filtered = useMemo(
    () => (data ? filterDeskPayload(data, projectId ?? null) : null),
    [data, projectId],
  );

  return { data: filtered, loading, error, refresh };
}

/**
 * Narrow a desk payload to one project.
 *
 * Done on the client rather than with a `?projectId=` query so the two routes
 * share ONE cached response shape and one server derivation — the ranks, the
 * merge readiness and the queue order must be identical whether or not a
 * project chip is active, and computing them twice is how they stop being.
 */
export function filterDeskPayload(
  payload: ControlDeskPayload,
  projectId: string | null,
): ControlDeskPayload {
  if (!projectId) return payload;
  const keep = <T extends { projectId: string }>(rows: readonly T[]): T[] =>
    rows.filter((row) => row.projectId === projectId);

  return {
    ...payload,
    projects: payload.projects.filter((project) => project.id === projectId),
    working: keep(payload.working),
    queued: keep(payload.queued),
    yourTurn: {
      awaitingReply: keep(payload.yourTurn.awaitingReply),
      failed: keep(payload.yourTurn.failed),
      conflicts: keep(payload.yourTurn.conflicts),
      ...(payload.yourTurn.parked ? { parked: keep(payload.yourTurn.parked) } : {}),
    },
    readyToLand: keep(payload.readyToLand),
    upNext: payload.upNext.filter((row) => row.projectId === projectId),
  };
}
