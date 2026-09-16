"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { usePolledResource } from "@/hooks/usePolledResource";
import { requestJson } from "@/lib/api/client";

/**
 * Where a ticket stands in its own column — `GET …/epics/:epicId/position`.
 *
 * `rank` is 1-based in execution order (`epics.position`, then id) among the
 * project's tickets of the same status. It is a per-column rank, deliberately
 * not UP NEXT's number, which skips blocked tickets and merges two columns.
 */
export interface TicketQueuePlacement {
  status: string;
  rank: number;
  total: number;
  /** false for done and released: their order is history, not a queue. */
  movable: boolean;
}

/** Mirrors `COLUMN_MOVES` in lib/workflow/reorder.ts (server-only module). */
export type TicketQueueMove = "up" | "down" | "top" | "bottom";

function isPlacement(value: unknown): value is TicketQueuePlacement {
  const candidate = value as Partial<TicketQueuePlacement> | null;
  return (
    typeof candidate?.status === "string" &&
    typeof candidate.rank === "number" &&
    typeof candidate.total === "number" &&
    typeof candidate.movable === "boolean"
  );
}

const readError = () => "Unable to load the queue position";

/**
 * The PIPELINE card's manual re-ordering (audit #119): the ticket's rank in
 * its column and the four moves the position route accepts.
 *
 * Read once per ticket; never polled. It is re-read when `status` changes
 * (the ticket left the column the rank was counted in) and whenever the
 * caller calls `refresh` — the overlay does on `ticket:updated` for this
 * ticket (what the route emits for the moved ticket), on any ticket of the
 * project being created, moved or deleted, and on the stream's fallback tick.
 * A neighbour re-ranked by the position route or by Refinement emits nothing
 * this ticket hears, so its rank can still lag until one of those; the server
 * answers a move past a stale edge with a no-op and a fresh placement.
 */
export function useTicketQueuePosition(
  projectId: string,
  epicId: string | null,
  status: string | null,
  enabled: boolean = true,
) {
  const t = useTranslations("Ticket");
  const url =
    enabled && projectId && epicId
      ? `/api/projects/${projectId}/epics/${epicId}/position`
      : null;
  const { data, refresh, updateData } = usePolledResource<TicketQueuePlacement>(
    url,
    null,
    readError,
    { validateData: isPlacement },
  );
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the status the last read was issued for, not on "data disagrees
  // with status": a detail read lagging the placement would otherwise make
  // every answer trigger another read. The first KNOWN status (null → the
  // ticket's column, once its detail arrives) needs no re-read: the mount
  // read did not depend on it.
  const readForStatus = useRef(status);
  useEffect(() => {
    const previous = readForStatus.current;
    if (previous === status) return;
    readForStatus.current = status;
    if (previous !== null) void refresh();
  }, [status, refresh]);

  const move = useCallback(
    async (direction: TicketQueueMove) => {
      if (!url) return;
      setMoving(true);
      setError(null);
      const result = await requestJson<TicketQueuePlacement>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: direction }),
        errorMessage: t("pipeline.queue.moveError"),
        validateData: isPlacement,
      });
      setMoving(false);
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      updateData(result.data);
    },
    [url, t, updateData],
  );

  // A rank counted in another column is not this ticket's rank: hide it until
  // the re-read above lands rather than offer moves in the wrong queue.
  const placement = data && (!status || data.status === status) ? data : null;

  return { placement, moving, error, move, refresh };
}
