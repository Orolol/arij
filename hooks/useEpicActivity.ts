"use client";

import { usePolledResource } from "@/hooks/usePolledResource";
const loadError = () => "Unable to load ticket activity";
const isEntries = (value: unknown): value is EpicActivityEntry[] => Array.isArray(value);

/** One kanban transition from the ticket activity log (newest first from the API). */
export interface EpicActivityEntry {
  id: string;
  projectId: string;
  epicId: string;
  fromStatus: string;
  toStatus: string;
  actor: "user" | "agent" | "system";
  reason: string | null;
  sessionId: string | null;
  createdAt: string | null;
}

const EMPTY_ENTRIES: EpicActivityEntry[] = [];

/**
 * Loads and polls (5s) the transition activity log of an epic.
 *
 * Mirrors `useTicketComments`' shape. `enabled` gates the polling so callers
 * only poll while the Activity tab is actually visible; a null epicId
 * resolves to an empty, non-polling feed.
 */
export function useEpicActivity(
  projectId: string,
  epicId: string | null,
  enabled: boolean = true
) {
  const activityUrl = epicId
    ? `/api/projects/${projectId}/epics/${epicId}/activity`
    : null;

  const { data, loading, error, refresh } = usePolledResource<EpicActivityEntry[]>(enabled && projectId ? activityUrl : null, 5000, loadError, { validateData: isEntries });
  return { entries: data ?? EMPTY_ENTRIES, loading, error, refresh };
}
