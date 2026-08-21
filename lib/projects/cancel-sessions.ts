import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { activityRegistry } from "@/lib/activity-registry";
import { agentScheduler } from "@/lib/agents/scheduler";
import { processManager } from "@/lib/claude/process-manager";
import { markSessionCancelled } from "@/lib/agent-sessions/lifecycle";

/** Statuses that still own a process, a queue slot, or both. */
const LIVE_STATUSES = ["queued", "running"] as const;

export interface CancelProjectSessionsResult {
  /** DB-tracked sessions moved to `cancelled`. */
  sessions: string[];
  /** Ephemeral chat/spec/release activities killed. */
  activities: string[];
}

/**
 * Stops everything currently running for a project.
 *
 * Called before a project is deleted, for two reasons that both bite: the
 * project row cascades into `agent_sessions`, which would strand a live CLI
 * process with no record of what it belongs to; and when the caller is also
 * removing the clone, an agent writing into a directory being deleted produces
 * exactly the kind of half-state this epic exists to avoid.
 *
 * Best-effort per session — one uncancellable session never blocks the rest.
 */
export function cancelProjectSessions(
  projectId: string,
  reason = "Project deleted"
): CancelProjectSessionsResult {
  const live = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, [...LIVE_STATUSES])
      )
    )
    .all();

  const sessions: string[] = [];
  const now = new Date().toISOString();

  for (const { id } of live) {
    try {
      // Drop a not-yet-started launch from the queue, then kill any live
      // process — same order as DELETE /api/.../sessions/[sessionId].
      agentScheduler.remove(id);
      processManager.cancel(id);
      markSessionCancelled(id, reason, now);
      sessions.push(id);
    } catch (error) {
      console.warn(
        `[project-delete] could not cancel session ${id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const activities: string[] = [];
  for (const activity of activityRegistry.listByProject(projectId)) {
    try {
      if (activityRegistry.cancel(activity.id)) activities.push(activity.id);
    } catch (error) {
      console.warn(
        `[project-delete] could not cancel activity ${activity.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { sessions, activities };
}
