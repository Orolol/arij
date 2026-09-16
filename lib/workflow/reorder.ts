/**
 * Shared reorder core — the transactional position update used by the manual
 * one-ticket move (POST /epics/:epicId/position, via `moveTicketInColumn`)
 * and by agent-facing reordering (the refinement MCP tools).
 *
 * One pass validates every status change through the workflow engine, one
 * better-sqlite3 transaction writes all positions atomically, and status
 * changes are applied through the same transition service afterwards, so a
 * half-reordered board is never visible.
 *
 * THIS MODULE, TOGETHER WITH THE TWO TRANSITION-ONLY WRITERS BELOW IT, IS THE
 * DEFINITION OF `epics.position`. Position is a per-column 0..n-1 sequence
 * (`KANBAN_COLUMNS` scoping every write) and it is Full Auto's
 * execution-order input: `compareExecutionOrder` (lib/kanban/queue.ts) reads
 * status rank then position, and `selectBuildCandidates` inherits that order.
 * Two consequences for every other module: never write a position to express
 * a DISPLAY order (a desk band's sort must stay in the derivation — see
 * `deriveReadyToLand` in lib/control-desk/aggregate.ts), and never treat
 * position as a global sequence across columns. The retired board's
 * `persistedColumnOrder` helper used to spell this contract out; it went with
 * the board, so it lives here now.
 */

import Database from "better-sqlite3";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import type { KanbanStatus } from "@/lib/types/kanban";
import { KANBAN_COLUMNS } from "@/lib/types/kanban";
import { compareExecutionOrder } from "@/lib/kanban/queue";
import { applyTransition } from "@/lib/workflow/transition-service";

export interface ReorderItemInput {
  id: string;
  /** Target status; equal to the current status when the item only moves in position. */
  status: string;
  position: number;
}

export interface ReorderContext {
  actor: "user" | "agent";
  /**
   * "api" for the manual position route, "refinement" for the agent re-pass.
   * The source reaches the workflow engine, where "refinement" is what pins a
   * transition to the Backlog / To do columns.
   */
  source: "api" | "refinement";
  /** Activity-log reason recorded for any status change. */
  reason?: string;
  /**
   * "I am only reordering; never move anything."
   *
   * Each item carries the status the CALLER believes the ticket has, and a
   * mismatch with the stored one is otherwise read as a requested move. That
   * is wrong for any caller that only re-ranks — the manual move rewriting
   * its whole column, or an agent re-ranking a snapshot it read moments ago:
   * on a board that has moved on, it would either fail the whole operation
   * on a refused transition or silently demote a ticket nobody moved.
   *
   * With this set, an item whose stored status differs is skipped instead —
   * its index means nothing in a column it is not in — and the count comes
   * back so the caller can re-sync.
   *
   * A pure re-rank also leaves `updatedAt` alone: the registry reads it for
   * "updated … ago", "waiting since" and its activity sort, and a rank is not
   * an edit of every ticket in the column. A caller that wants its one moved
   * ticket to read as updated stamps it itself (`moveTicketInColumn`).
   */
  reorderOnly?: boolean;
  /**
   * Restrict which columns the items may currently sit in. The refinement
   * tools pass ["backlog", "todo"] — their guardrail is that they never
   * touch in progress / review / done.
   */
  onlyFromStatuses?: readonly string[];
}

export type ReorderTicketsResult =
  | {
      ok: true;
      updated: number;
      skipped: number;
      /** Ids whose position was actually written — what callers may journal. */
      updatedIds: string[];
      /** Ids left alone because their stored column had moved on. */
      skippedIds: string[];
    }
  | { ok: false; error: string; statusCode: number };

export function reorderTickets(
  projectId: string,
  items: ReorderItemInput[],
  ctx: ReorderContext
): ReorderTicketsResult {
  const now = new Date().toISOString();

  // Reject any items that target the "released" column.
  for (const item of items) {
    if (item.status === "released") {
      return {
        ok: false,
        error:
          "Cannot move tickets to the Released column. Tickets are moved there automatically when a release is created.",
        statusCode: 400,
      };
    }
  }

  // Validate workflow rules for any status changes and track moves.
  // Lookups are project-scoped: epic ids from other projects are skipped.
  const statusChanges: { epicId: string; from: KanbanStatus; to: KanbanStatus }[] = [];
  const validItems: ReorderItemInput[] = [];
  const skippedIds: string[] = [];
  for (const item of items) {
    const epic = db
      .select()
      .from(epics)
      .where(and(eq(epics.id, item.id), eq(epics.projectId, projectId)))
      .get();
    if (!epic) continue;

    const fromStatus = (epic.status ?? "backlog") as KanbanStatus;

    // A pure reorder leaves stale rows alone rather than moving them (see
    // `reorderOnly`). This covers a card the caller believes is elsewhere,
    // including one that has since been released.
    if (ctx.reorderOnly && fromStatus !== (item.status as KanbanStatus)) {
      skippedIds.push(item.id);
      continue;
    }

    validItems.push(item);

    // Reject moves from the released column
    if (fromStatus === "released") {
      return {
        ok: false,
        error:
          "Cannot move tickets out of the Released column. Released tickets cannot be moved.",
        statusCode: 400,
      };
    }

    if (ctx.onlyFromStatuses && !ctx.onlyFromStatuses.includes(fromStatus)) {
      return {
        ok: false,
        error: `Cannot reorder ${epic.readableId ?? item.id} from the ${fromStatus} column.`,
        statusCode: 409,
      };
    }

    const toStatus = item.status as KanbanStatus;

    // Only validate if status is actually changing
    if (fromStatus !== toStatus) {
      if (!KANBAN_COLUMNS.includes(toStatus)) {
        return { ok: false, error: `Invalid status: ${toStatus}`, statusCode: 400 };
      }

      const result = applyTransition({
        projectId,
        epicId: item.id,
        fromStatus,
        toStatus,
        actor: ctx.actor,
        source: ctx.source,
        validateOnly: true,
      });
      if (!result.valid) {
        return {
          ok: false,
          error: result.error ?? `Cannot move from ${fromStatus} to ${toStatus}.`,
          statusCode: 400,
        };
      }
      statusChanges.push({ epicId: item.id, from: fromStatus, to: toStatus });
    }
  }

  // Use a transaction for atomic reorder.
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const transaction = sqlite.transaction(() => {
    for (const item of validItems) {
      db.update(epics)
        .set(
          ctx.reorderOnly
            ? { position: item.position }
            : { position: item.position, updatedAt: now }
        )
        .where(eq(epics.id, item.id))
        .run();
    }
  });

  transaction();

  // Apply status changes through the workflow service after the atomic
  // position update; the full set was validated above.
  for (const change of statusChanges) {
    const result = applyTransition({
      projectId,
      epicId: change.epicId,
      fromStatus: change.from,
      toStatus: change.to,
      actor: ctx.actor,
      source: ctx.source,
      reason: ctx.reason,
      // No sessionId on purpose: applyTransition treats it as the engine's
      // owning-session exemption input, not as provenance, and no reorder
      // caller owns the ticket it is moving.
    });
    if (!result.valid) {
      return {
        ok: false,
        error:
          result.error ??
          `Cannot move from ${change.from} to ${change.to}.`,
        statusCode: 409,
      };
    }
  }

  return {
    ok: true,
    updated: validItems.length,
    skipped: skippedIds.length,
    updatedIds: validItems.map((item) => item.id),
    skippedIds,
  };
}

/* ------------------------------------------------------------------ */
/* Manual one-ticket move                                              */
/* ------------------------------------------------------------------ */

/**
 * Columns whose order somebody reads, and which a person may therefore
 * re-rank by hand.
 *
 * - backlog / todo: the planning queue Refinement ranks and promotion reads.
 * - in_progress: the build selector spans it (ahead of To do) in position
 *   order, and UP NEXT draws it first.
 * - review / to_merge: `selectReviewCandidates` and `selectMergeCandidates`
 *   sort with the same `compareExecutionOrder`, so position decides which
 *   branch is reviewed or landed first, and READY TO LAND lists in it.
 *
 * done and released are history: nothing is picked up from them, and the
 * core refuses to write around a released ticket anyway.
 */
export const MANUAL_REORDER_STATUSES: ReadonlySet<string> = new Set([
  "backlog",
  "todo",
  "in_progress",
  "review",
  "to_merge",
]);

export const COLUMN_MOVES = ["up", "down", "top", "bottom"] as const;
export type ColumnMove = (typeof COLUMN_MOVES)[number];

/** Where one ticket stands inside its own column. */
export interface ColumnPlacement {
  status: string;
  /** 1-based, in execution order (`compareExecutionOrder`). */
  rank: number;
  total: number;
  movable: boolean;
}

interface ColumnRow {
  id: string;
  status: string;
  position: number | null;
}

/**
 * One project's column, in the order Full Auto and the desk read it. A NULL
 * status is Backlog everywhere else in the workflow, so it is here too.
 */
function readColumn(projectId: string, status: string): ColumnRow[] {
  return db
    .select({ id: epics.id, status: epics.status, position: epics.position })
    .from(epics)
    .where(
      and(
        eq(epics.projectId, projectId),
        or(eq(epics.status, status), isNull(epics.status))
      )
    )
    .all()
    .map((row) => ({ ...row, status: row.status ?? "backlog" }))
    .filter((row) => row.status === status)
    .sort(compareExecutionOrder);
}

function placementIn(column: ColumnRow[], epicId: string, status: string): ColumnPlacement {
  return {
    status,
    rank: column.findIndex((row) => row.id === epicId) + 1,
    total: column.length,
    movable: MANUAL_REORDER_STATUSES.has(status),
  };
}

function currentStatus(projectId: string, epicId: string): string | null {
  const row = db
    .select({ status: epics.status })
    .from(epics)
    .where(and(eq(epics.id, epicId), eq(epics.projectId, projectId)))
    .get();
  return row ? (row.status ?? "backlog") : null;
}

/** The ticket's placement, or null when it is not a ticket of this project. */
export function readColumnPlacement(
  projectId: string,
  epicId: string
): ColumnPlacement | null {
  const status = currentStatus(projectId, epicId);
  if (status === null) return null;
  return placementIn(readColumn(projectId, status), epicId, status);
}

export type MoveTicketResult =
  | {
      ok: true;
      /** False for the edge no-ops (up on the first, down on the last). */
      moved: boolean;
      /** The ticket's position after the move — its new 0-based index. */
      position: number;
      placement: ColumnPlacement;
    }
  | { ok: false; error: string; statusCode: number };

/**
 * Move one ticket inside its column and leave that column numbered 0..n-1.
 *
 * The order is recomputed here from the database, never taken from the
 * client: a caller holding a stale list would otherwise write its picture of
 * the column over a queue the supervisor or Refinement has since changed.
 * Renumbering the column (not swapping two values) also heals a column left
 * with gaps or duplicate positions, which `compareExecutionOrder` could only
 * break by id — but only the rows whose position actually changes are
 * written, and only the moved ticket is stamped as updated.
 *
 * Read, computation and write run in ONE SQLite transaction. Inside this
 * process nothing could interleave anyway (better-sqlite3 is synchronous and
 * there is no await here), but another process on the same database — the CLI,
 * a second server — could otherwise re-rank the column between the read and
 * the write. The core's own transaction nests as a savepoint.
 */
export function moveTicketInColumn(
  projectId: string,
  epicId: string,
  move: ColumnMove
): MoveTicketResult {
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  return sqlite.transaction((): MoveTicketResult => {
    const status = currentStatus(projectId, epicId);
    if (status === null) {
      return { ok: false, error: "Ticket not found", statusCode: 404 };
    }
    if (!MANUAL_REORDER_STATUSES.has(status)) {
      return {
        ok: false,
        error: `Tickets in ${status} cannot be re-ordered: nothing is picked up from that column.`,
        statusCode: 409,
      };
    }

    const column = readColumn(projectId, status);
    const from = column.findIndex((row) => row.id === epicId);
    const last = column.length - 1;
    const to =
      move === "top" ? 0
      : move === "bottom" ? last
      : move === "up" ? Math.max(0, from - 1)
      : Math.min(last, from + 1);

    if (to === from) {
      return { ok: true, moved: false, position: from, placement: placementIn(column, epicId, status) };
    }

    const reordered = [...column];
    const [ticket] = reordered.splice(from, 1);
    reordered.splice(to, 0, ticket);

    // No `reason`: a pure re-rank makes no transition, so the core would never
    // write one. The route journals the move itself.
    const result = reorderTickets(
      projectId,
      reordered
        .map((row, index) => ({ id: row.id, status, position: index, previous: row.position }))
        .filter((row) => row.position !== row.previous)
        .map(({ id, position }) => ({ id, status, position })),
      { actor: "user", source: "api", reorderOnly: true }
    );
    if (!result.ok) return result;

    db.update(epics)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(epics.id, epicId))
      .run();

    // Re-read rather than trust `reordered`: that is the placement every other
    // reader of the column will see from now on.
    const placement = readColumnPlacement(projectId, epicId);
    if (!placement) {
      return { ok: false, error: "Ticket not found", statusCode: 404 };
    }
    return { ok: true, moved: true, position: placement.rank - 1, placement };
  })();
}
