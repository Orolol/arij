import { topologicalSort } from "@/lib/dependencies/validation";

export type TicketExecutionStatus =
  | "pending"
  | "running"
  | "done"
  /** Session succeeded but ended by asking a question — blocks dependents. */
  | "asked"
  | "failed"
  | "skipped";

export interface BatchExecutionPlan {
  /** Topological layers — tickets in the same layer can run concurrently */
  layers: string[][];
  /** Per-ticket execution state */
  ticketStatus: Map<string, TicketExecutionStatus>;
  /** Per-ticket failure/skip reason (only for failed/skipped tickets) */
  failureReasons: Map<string, string>;
}

export interface LayerResult {
  epicId: string;
  success: boolean;
  sessionId: string;
  error?: string;
}

/**
 * Build a DAG-aware execution plan for a set of ticket IDs.
 * Returns topological layers and an initial status map (all pending).
 */
export function buildExecutionPlan(
  projectId: string,
  ticketIds: string[]
): BatchExecutionPlan {
  const layers = topologicalSort(projectId, ticketIds);
  const ticketStatus = new Map<string, TicketExecutionStatus>();
  const failureReasons = new Map<string, string>();
  for (const id of ticketIds) {
    ticketStatus.set(id, "pending");
  }
  return { layers, ticketStatus, failureReasons };
}

