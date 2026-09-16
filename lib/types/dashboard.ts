export interface DashboardProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  gitRepoPath: string | null;
  githubOwnerRepo: string | null;
  defaultBranch?: string | null;
  cloneSource?: string | null;
  imported: number;
  createdAt: string;
  updatedAt: string;
  activeAgents: number;
}

export type ProjectFilter = "all" | "active" | "archived";
