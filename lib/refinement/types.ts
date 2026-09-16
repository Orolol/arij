export interface RefinementStatus {
  running: boolean;
  sessionId: string | null;
  /** Tickets currently sitting in Backlog + To do — the pass's workload. */
  ticketCount: number;
}
