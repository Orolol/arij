import fs from "node:fs";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { resolveVerifyConfigForProject } from "./config";
import { assertManagedEpicWorktreePath } from "./worktree";
import type { VerifyConfig } from "./verify-constants";

export interface EpicVerificationPlan { worktreePath: string; commands: VerifyConfig["commands"]; timeoutMs: number; codeSessionId: string; }
/** Both manual and pipeline verification validate the same latest code evidence. */
export function planEpicVerification(projectId: string, epicId: string, options: { codeSessionId?: string | null } = {}): { plan: EpicVerificationPlan | null; reason?: string } {
  try {
    const config = resolveVerifyConfigForProject(projectId);
    if (!config.enabled) return { plan: null };
    if (options.codeSessionId === null) return { plan: null, reason: "deterministic verification requires a code session" };
    const session = db.select().from(agentSessions).where(and(
      eq(agentSessions.projectId, projectId), eq(agentSessions.epicId, epicId),
      options.codeSessionId ? eq(agentSessions.id, options.codeSessionId) : inArray(agentSessions.agentType, ["build", "ticket_build", "team_build", "fix", "merge"]),
    )).orderBy(desc(sql`julianday(COALESCE(${agentSessions.endedAt}, ${agentSessions.completedAt}, ${agentSessions.createdAt}))`), desc(agentSessions.id)).get();
    if (!session?.worktreePath) return { plan: null, reason: "no epic worktree recorded by the last code session" };
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project?.gitRepoPath) return { plan: null, reason: "deterministic verification requires a Git repository" };
    assertManagedEpicWorktreePath(session.worktreePath, project.gitRepoPath);
    if (!fs.existsSync(session.worktreePath)) return { plan: null, reason: "the recorded epic worktree no longer exists on disk (pruned?)" };
    return { plan: { worktreePath: session.worktreePath, commands: config.commands, timeoutMs: config.timeoutMs, codeSessionId: session.id } };
  } catch (error) {
    return { plan: null, reason: `applicability check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
