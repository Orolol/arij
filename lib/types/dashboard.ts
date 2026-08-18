export interface DashboardProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  gitRepoPath: string | null;
  githubOwnerRepo: string | null;
  imported: number;
  createdAt: string;
  updatedAt: string;
  epicCount: number;
  epicsDone: number;
  /** Epics currently in the `in_progress` column. */
  epicsInProgress: number;
  /** Epics currently in the `review` column. */
  epicsReview: number;
  /** Epics already shipped in a release (`released` column). */
  epicsReleased: number;
  activeAgents: number;
  /** MAX(agent_sessions.created_at) for the project, ISO-UTC, null if none. */
  lastSessionAt: string | null;
}

export type ProjectFilter = "all" | "active" | "archived";
