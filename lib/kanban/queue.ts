/**
 * Board execution-queue, blocked-state, and readiness helpers.
 *
 * Pure, deterministic functions backing the board's execution visibility:
 * effective queue ranking of the To Do column and dependency-blocked
 * detection.
 *
 * ORDER. `compareExecutionOrder` below is the single definition of "the order
 * work is picked up in", shared with the Full Auto supervisor —
 * `compareEpics` in lib/auto-mode/select.ts IS this function. That is what
 * keeps parent-ticket queue order consistent with the supervisor. Its
 * runtime exclusions and story-level work are separate from display ranks.
 * Dependency blocking is shared
 * too: `selectBuildCandidates` runs the transitive prerequisite gate from
 * lib/dependencies/validation.ts, and this module's `computeBlockedBy` is its
 * direct-edge equivalent for display.
 *
 * A UI built on this module ranks parent tickets; it is not a complete
 * scheduler preview. The caller decides which facts exclude a ticket.
 */

import { isDeliveredStatus, type TicketDependencyEdge } from "@/lib/types/kanban";

/**
 * Execution-order rank of a column.
 *
 * In Progress ranks before To Do: a ticket sitting there came back from a
 * negative review, and finishing work already started beats opening a new
 * front. Everything else sorts last, among itself.
 *
 * `position` is written PER COLUMN — creation uses `MAX(position) + 1` scoped
 * to the target status, and the reorder core rewrites each column as 0..n-1 —
 * so every column has its own position 0 and position alone is not a total
 * order over a set spanning two columns. The column is the primary key,
 * position the secondary one.
 */
const EXECUTION_COLUMN_RANK: Readonly<Record<string, number>> = {
  in_progress: 0,
  todo: 1,
};

/** Columns the build selector does not span sort last, among themselves. */
const UNRANKED_COLUMN = 2;

/** The minimum an epic must carry to be placed in execution order. */
export interface ExecutionOrderEpic {
  id: string;
  status?: string | null;
  position?: number | null;
}

/**
 * The order work is picked up in: column rank, then position ASC, then id.
 *
 * Within a column, position ASC is the column's visual reading order —
 * position is the single source of truth for execution order, so what the user
 * sees is what the supervisor runs (WYSIWYG). Priority stays a badge and a
 * filter, never a scheduling criterion; Refinement's `reorder_tickets` makes
 * it visible in the order by rewriting positions in bulk.
 *
 * The `id` tiebreak only fires on a malformed board (two rows sharing a
 * position after a partial write). It is arbitrary but deterministic, which
 * beats "whatever SQLite returned first".
 *
 * Lives here, in the client-safe predicate layer, so the supervisor
 * (lib/auto-mode/select.ts) and every UI that claims to show its queue read
 * ONE definition. A second copy is a divergence waiting to happen.
 */
export function compareExecutionOrder(
  a: ExecutionOrderEpic,
  b: ExecutionOrderEpic,
): number {
  const byColumn =
    (EXECUTION_COLUMN_RANK[a.status ?? ""] ?? UNRANKED_COLUMN) -
    (EXECUTION_COLUMN_RANK[b.status ?? ""] ?? UNRANKED_COLUMN);
  if (byColumn !== 0) return byColumn;

  const byPosition = (a.position ?? 0) - (b.position ?? 0);
  if (byPosition !== 0) return byPosition;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Per-epic blocked map: for every epic that declares unmet dependencies,
 * the ids of the dependency targets that are not done/released yet.
 * Epics with all dependencies satisfied are absent from the map.
 *
 * A dependent that is itself delivered is never blocked, whatever its
 * prerequisites look like: an explicit human action can deliver a dependent
 * first, and a Done card must not advertise a block it has already outlived.
 */
export function computeBlockedBy(
  edges: readonly TicketDependencyEdge[],
  statusById: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const blockedBy = new Map<string, string[]>();
  for (const edge of edges) {
    if (isDeliveredStatus(statusById.get(edge.ticketId))) continue;
    if (isDeliveredStatus(statusById.get(edge.dependsOnTicketId))) continue;
    const list = blockedBy.get(edge.ticketId) ?? [];
    list.push(edge.dependsOnTicketId);
    blockedBy.set(edge.ticketId, list);
  }
  return blockedBy;
}

/**
 * Effective execution order of an already-ordered candidate list.
 *
 * Iterates the epics in the order given — sort them with
 * {@link compareExecutionOrder} first; a ticket excluded by `isExcluded`
 * (blocked or awaiting its user's reply) does not consume a number. The first
 * numbered ticket is rank 1 — the "next" one.
 *
 * Generic over the row shape: the only field it reads is `id`, and the desk
 * feeds it rows that are not full epics.
 */
export function computeQueueRanks<T extends { id: string }>(
  todoEpics: readonly T[],
  isExcluded: (epic: T) => boolean,
): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const epic of todoEpics) {
    if (isExcluded(epic)) continue;
    rank += 1;
    ranks.set(epic.id, rank);
  }
  return ranks;
}
