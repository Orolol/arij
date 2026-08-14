/**
 * Client-side shape of an agent session as returned by
 * `/api/projects/:projectId/sessions/active`.
 */
export interface AgentSession {
  id: string;
  epicId: string | null;
  userStoryId: string | null;
  status: string;
  mode: string;
  provider: string | null;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
