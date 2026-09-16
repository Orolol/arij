"use client";

/**
 * The visual proofs build agents attached to one ticket, via
 * `GET /api/projects/:projectId/epics/:epicId/artifacts`.
 *
 * A single read, never polled: artifacts only ever appear through
 * `attach_artifact`, which announces each one as `artifact:created`, so the
 * caller re-reads on that event (and on its own SSE refresh bump) instead of
 * spending a timer on a list that is static between events. A failed re-read
 * keeps the last good list on screen next to the error — `usePolledResource`
 * retains it — rather than blanking evidence that was already loaded.
 *
 * The ERROR is sticky the same way. `usePolledResource.reload` clears it the
 * moment a re-read starts, and the band draws nothing when there is neither a
 * proof nor an error — so an empty, failed list would unmount its own Retry
 * under the cursor (focus falling to <body>) and blink back when the read
 * failed again. The message therefore stays until a read actually succeeds,
 * and is dropped only when the target ticket changes.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { usePolledResource } from "@/hooks/usePolledResource";
import type { SessionArtifactSummary } from "@/lib/agent-sessions/artifact-view";

function isArtifactSummary(value: unknown): value is SessionArtifactSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.agentSessionId === "string" &&
    typeof row.epicId === "string" &&
    typeof row.caption === "string" &&
    (row.createdAt === null || typeof row.createdAt === "string")
  );
}

function isArtifactList(value: unknown): value is SessionArtifactSummary[] {
  return Array.isArray(value) && value.every(isArtifactSummary);
}

const NO_ARTIFACTS: SessionArtifactSummary[] = [];

export function useEpicArtifacts(projectId: string, epicId: string | null) {
  const tErrors = useTranslations("ClientErrors");
  const url =
    projectId && epicId
      ? `/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/artifacts`
      : null;
  const errorMessage = useCallback(
    () => tErrors("failedToLoadVisualProofs"),
    [tErrors],
  );
  const { data, loading, error, refresh } = usePolledResource<
    SessionArtifactSummary[]
  >(url, null, errorMessage, { validateData: isArtifactList });

  // React's render-phase adjustment, keyed by URL so a ticket switch never
  // inherits the previous ticket's failure. An effect would paint one frame
  // without the band.
  const [shown, setShown] = useState<{ url: string | null; error: string | null }>(
    { url, error: null },
  );
  let next = shown;
  if (shown.url !== url) next = { url, error };
  else if (error && error !== shown.error) next = { url, error };
  else if (!error && !loading && shown.error !== null) next = { url, error: null };
  if (next !== shown) setShown(next);

  return {
    artifacts: data ?? NO_ARTIFACTS,
    loading,
    error: next.error,
    refresh,
  };
}
