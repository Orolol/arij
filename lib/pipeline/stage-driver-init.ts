/**
 * Per-run identity of the pipeline stage driver. One driver per run
 * (createPipelineStageDriver in stages.ts); every stage module receives
 * this same record.
 */
export interface PipelineStageDriverInit {
  projectId: string;
  scope: "epic" | "story";
  epicId: string;
  userStoryId: string | null;
  /** The run's original request-level namedAgentId (attempt-1 code stages). */
  buildNamedAgentId: string | null;
  /**
   * Named agent for attempt-1 review stages. NULL — the default, and what
   * every pre-existing caller gets — keeps the historical behaviour: the
   * review stage resolves through `resolveAgentForDispatch(..., null, {purpose:
   * 'review'})` so reviewer segregation can pick a provider different from the
   * builder's. Full Auto Mode sets it because the user picked a review agent
   * explicitly, and an explicit choice always beats segregation
   * (lib/agent-config/agent-resolution.ts:428).
   */
  reviewNamedAgentId?: string | null;
  /**
   * Batch/night run that owns this pipeline; stamped on every stage session
   * row (agent_sessions.batch_run_id). Null for standalone runs.
   */
  batchRunId?: string | null;
}
