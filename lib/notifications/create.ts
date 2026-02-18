import { eq, desc } from "drizzle-orm";
import { db, sqlite } from "@/lib/db";
import {
  agentSessions,
  projects,
  epics,
  notifications,
} from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { AGENT_TYPE_LABELS } from "@/lib/agent-config/constants";

const MAX_NOTIFICATIONS = 200;

/**
 * Build a human-readable notification title from session context.
 *
 * Examples:
 *   "Build completed — E-proj-003: Login feature"
 *   "Tech check failed"
 *   "Review: Code completed"
 */
export function buildTitle(
  agentType: string | null,
  status: "completed" | "failed",
  epicTitle?: string | null,
  epicReadableId?: string | null
): string {
  const label =
    (agentType && AGENT_TYPE_LABELS[agentType as keyof typeof AGENT_TYPE_LABELS]) ||
    agentType ||
    "Agent";
  const verb = status === "completed" ? "completed" : "failed";
  const base = `${label} ${verb}`;

  if (epicReadableId && epicTitle) {
    return `${base} \u2014 ${epicReadableId}: ${epicTitle}`;
  }
  if (epicTitle) {
    return `${base} \u2014 ${epicTitle}`;
  }
  return base;
}

/**
 * Build the target URL for a notification.
 *
 * tech_check and e2e_test navigate to the QA tab; everything else to the session detail.
 */
export function buildTargetUrl(
  projectId: string,
  sessionId: string,
  agentType: string | null
): string {
  if (agentType === "tech_check" || agentType === "e2e_test") {
    return `/projects/${projectId}/qa`;
  }
  return `/projects/${projectId}/sessions/${sessionId}`;
}

/**
 * Create a notification row from a completed/failed agent session.
 *
 * Looks up the session, project, and optional epic context, then inserts
 * a notification row and prunes old entries beyond MAX_NOTIFICATIONS.
 */
export function createNotificationFromSession(sessionId: string): void {
  const session = db
    .select({
      id: agentSessions.id,
      projectId: agentSessions.projectId,
      epicId: agentSessions.epicId,
      status: agentSessions.status,
      agentType: agentSessions.agentType,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) return;

  const notifStatus =
    session.status === "failed" ? "failed" : "completed";

  const project = db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .get();

  if (!project) return;

  let epicTitle: string | null = null;
  let epicReadableId: string | null = null;
  if (session.epicId) {
    const epic = db
      .select({ title: epics.title, readableId: epics.readableId })
      .from(epics)
      .where(eq(epics.id, session.epicId))
      .get();
    if (epic) {
      epicTitle = epic.title;
      epicReadableId = epic.readableId;
    }
  }

  const title = buildTitle(session.agentType, notifStatus, epicTitle, epicReadableId);
  const targetUrl = buildTargetUrl(session.projectId, session.id, session.agentType);

  db.insert(notifications)
    .values({
      id: createId(),
      projectId: session.projectId,
      projectName: project.name,
      sessionId: session.id,
      agentType: session.agentType,
      status: notifStatus,
      title,
      targetUrl,
    })
    .run();

  // Prune old notifications beyond MAX_NOTIFICATIONS
  pruneNotifications();
}

function pruneNotifications(): void {
  const count = sqlite
    .prepare("SELECT COUNT(*) AS cnt FROM notifications")
    .get() as { cnt: number };

  if (count.cnt > MAX_NOTIFICATIONS) {
    sqlite.exec(`
      DELETE FROM notifications
      WHERE id NOT IN (
        SELECT id FROM notifications
        ORDER BY created_at DESC
        LIMIT ${MAX_NOTIFICATIONS}
      )
    `);
  }
}
