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
import { durationMsBetween, sendProjectWebhook } from "@/lib/webhooks/send";

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
 * Title for an asked_question notification.
 *
 * Examples:
 *   "Agent asked a question on E-proj-003: Login feature"
 *   "Agent asked a question on Login feature"
 *   "Agent asked a question"
 */
export function buildAskedQuestionTitle(
  epicTitle?: string | null,
  epicReadableId?: string | null
): string {
  const base = "Agent asked a question";
  if (epicReadableId && epicTitle) {
    return `${base} on ${epicReadableId}: ${epicTitle}`;
  }
  if (epicReadableId || epicTitle) {
    return `${base} on ${epicReadableId ?? epicTitle}`;
  }
  return base;
}

/**
 * Deep link opening the epic on the kanban board (handled by the project
 * page's `?ticket=` query parameter).
 */
export function buildEpicTargetUrl(projectId: string, epicId: string): string {
  return `/projects/${projectId}?ticket=${epicId}`;
}

/**
 * Title for a watchdog "agent seems stalled" notification.
 *
 * Examples:
 *   "Agent seems stalled on E-proj-003: Login feature — no output for 5m"
 *   "Agent seems stalled on Login feature — no output for 12m"
 *   "Agent seems stalled — no output for 5m"
 */
export function buildStalledTitle(
  staleMinutes: number,
  epicTitle?: string | null,
  epicReadableId?: string | null
): string {
  const base = "Agent seems stalled";
  const suffix = `— no output for ${staleMinutes}m`;
  if (epicReadableId && epicTitle) {
    return `${base} on ${epicReadableId}: ${epicTitle} ${suffix}`;
  }
  if (epicReadableId || epicTitle) {
    return `${base} on ${epicReadableId ?? epicTitle} ${suffix}`;
  }
  return `${base} ${suffix}`;
}

interface SessionNotificationContext {
  session: {
    id: string;
    projectId: string;
    epicId: string | null;
    status: string | null;
    agentType: string | null;
    outcome: string | null;
    startedAt: string | null;
    endedAt: string | null;
    error: string | null;
  };
  projectName: string;
  epicTitle: string | null;
  epicReadableId: string | null;
}

/**
 * Shared session/project/epic lookup for notification creators.
 * Returns null when the session or project no longer exists.
 */
function loadSessionNotificationContext(
  sessionId: string
): SessionNotificationContext | null {
  const session = db
    .select({
      id: agentSessions.id,
      projectId: agentSessions.projectId,
      epicId: agentSessions.epicId,
      status: agentSessions.status,
      agentType: agentSessions.agentType,
      outcome: agentSessions.outcome,
      startedAt: agentSessions.startedAt,
      endedAt: agentSessions.endedAt,
      error: agentSessions.error,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) return null;

  const project = db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .get();

  if (!project) return null;

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

  return { session, projectName: project.name, epicTitle, epicReadableId };
}

/**
 * Create a notification row from a completed/failed agent session.
 *
 * Looks up the session, project, and optional epic context, then inserts
 * a notification row and prunes old entries beyond MAX_NOTIFICATIONS.
 *
 * Sessions whose delivery verdict is `asked_question` are skipped here: the
 * question-flavored notification is owned by
 * `createAskedQuestionNotificationFromSession` (invoked by the workflow's
 * asked-question handling), so the generic "completed" copy never shows up
 * for a run that actually stopped to ask the user something.
 */
export function createNotificationFromSession(sessionId: string): void {
  const context = loadSessionNotificationContext(sessionId);
  if (!context) return;
  const { session, projectName, epicTitle, epicReadableId } = context;

  if (session.outcome === "asked_question") return;

  const notifStatus =
    session.status === "failed" ? "failed" : "completed";

  const title = buildTitle(session.agentType, notifStatus, epicTitle, epicReadableId);
  const targetUrl = buildTargetUrl(session.projectId, session.id, session.agentType);

  db.insert(notifications)
    .values({
      id: createId(),
      projectId: session.projectId,
      projectName,
      sessionId: session.id,
      agentType: session.agentType,
      status: notifStatus,
      title,
      targetUrl,
    })
    .run();

  // Prune old notifications beyond MAX_NOTIFICATIONS
  pruneNotifications();

  // Fire-and-forget outbound webhook (no-op unless the project configured one).
  void sendProjectWebhook(session.projectId, {
    event: notifStatus === "failed" ? "session.failed" : "session.completed",
    ticketTitle: epicTitle,
    epicId: session.epicId,
    sessionId: session.id,
    durationMs: durationMsBetween(session.startedAt, session.endedAt),
    error: notifStatus === "failed" ? session.error : null,
    path: targetUrl,
  });
}

/**
 * Create the "Agent asked a question on <ticket>" notification for a session
 * that ended with the `asked_question` delivery verdict.
 *
 * Deep-links to the epic on the board when the session is epic-scoped,
 * falling back to the session detail otherwise (e.g. team builds).
 */
export function createAskedQuestionNotificationFromSession(
  sessionId: string
): void {
  const context = loadSessionNotificationContext(sessionId);
  if (!context) return;
  const { session, projectName, epicTitle, epicReadableId } = context;

  const title = buildAskedQuestionTitle(epicTitle, epicReadableId);
  const targetUrl = session.epicId
    ? buildEpicTargetUrl(session.projectId, session.epicId)
    : buildTargetUrl(session.projectId, session.id, session.agentType);

  db.insert(notifications)
    .values({
      id: createId(),
      projectId: session.projectId,
      projectName,
      sessionId: session.id,
      agentType: session.agentType,
      status: "completed",
      title,
      targetUrl,
    })
    .run();

  pruneNotifications();

  // The run did complete — keep the stable webhook vocabulary, but point the
  // deep link at the ticket awaiting the user's reply.
  void sendProjectWebhook(session.projectId, {
    event: "session.completed",
    ticketTitle: epicTitle,
    epicId: session.epicId,
    sessionId: session.id,
    durationMs: durationMsBetween(session.startedAt, session.endedAt),
    error: null,
    path: targetUrl,
  });
}

/**
 * Create the watchdog's "Agent seems stalled" notification for a running
 * session that has produced no output chunks past its staleness threshold
 * (see lib/agents/watchdog.ts, which also guarantees at-most-once delivery
 * per session).
 *
 * Deep-links to the session detail — the actionable place for a stall:
 * inspect the output streams, then cancel if the agent really hung.
 * Uses the "failed" notification status for alarm styling; the session row
 * itself is untouched (the watchdog never auto-kills).
 *
 * No outbound webhook: the session has not ended, and the webhook
 * vocabulary (session.completed / session.failed) is strictly terminal.
 */
export function createStalledSessionNotification(
  sessionId: string,
  staleMinutes: number
): void {
  const context = loadSessionNotificationContext(sessionId);
  if (!context) return;
  const { session, projectName, epicTitle, epicReadableId } = context;

  db.insert(notifications)
    .values({
      id: createId(),
      projectId: session.projectId,
      projectName,
      sessionId: session.id,
      agentType: session.agentType,
      status: "failed",
      title: buildStalledTitle(staleMinutes, epicTitle, epicReadableId),
      targetUrl: `/projects/${session.projectId}/sessions/${session.id}`,
    })
    .run();

  pruneNotifications();
}

export interface DagWaveOutcomeInput {
  projectId: string;
  /** 1-based wave that just settled with blocked tickets. */
  wave: number;
  totalWaves: number;
  /** Tickets whose session failed or ended by asking a question. */
  blocked: Array<{ epicId: string; kind: "failed" | "asked_question" }>;
  /** How many tickets were skipped as a consequence (dependents + stop policy). */
  skippedCount: number;
  /** True when the "stop" failure policy abandoned the remaining waves. */
  stopped: boolean;
}

/**
 * Title for a DAG wave that ended with blocked tickets.
 *
 * Examples:
 *   "Wave 2/4: E-proj-003 failed — 2 dependents skipped"
 *   "Wave 1/3: E-proj-001 asked a question — 1 dependent skipped"
 *   "Wave 1/3: 2 epics blocked — batch stopped, 4 tickets skipped"
 */
export function buildDagWaveOutcomeTitle(
  input: DagWaveOutcomeInput,
  epicLabel: (epicId: string) => string
): string {
  const head = `Wave ${input.wave}/${input.totalWaves}: `;
  const mid =
    input.blocked.length === 1
      ? `${epicLabel(input.blocked[0].epicId)} ${
          input.blocked[0].kind === "failed" ? "failed" : "asked a question"
        }`
      : `${input.blocked.length} epics blocked`;
  const tail = input.stopped
    ? ` — batch stopped, ${input.skippedCount} ticket${
        input.skippedCount === 1 ? "" : "s"
      } skipped`
    : input.skippedCount > 0
      ? ` — ${input.skippedCount} dependent${
          input.skippedCount === 1 ? "" : "s"
        } skipped`
      : "";
  return head + mid + tail;
}

/**
 * Notification summarizing a DAG build wave that blocked (failed sessions or
 * unanswered agent questions), skipping the blocked tickets' dependents.
 *
 * Not session-scoped: one wave can block on several sessions, and the
 * actionable place is the board where the skipped tickets sit — so the deep
 * link targets the project board rather than a single session.
 */
export function createDagWaveOutcomeNotification(
  input: DagWaveOutcomeInput
): void {
  const project = db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) return;

  const epicLabel = (epicId: string): string => {
    const epic = db
      .select({ readableId: epics.readableId, title: epics.title })
      .from(epics)
      .where(eq(epics.id, epicId))
      .get();
    return epic?.readableId || epic?.title || epicId;
  };

  // Alarm styling only when something actually failed; a wave blocked purely
  // by questions matches the asked-question notifications' "completed" state.
  const status = input.blocked.some((b) => b.kind === "failed")
    ? "failed"
    : "completed";

  db.insert(notifications)
    .values({
      id: createId(),
      projectId: input.projectId,
      projectName: project.name,
      sessionId: null,
      agentType: "build",
      status,
      title: buildDagWaveOutcomeTitle(input, epicLabel),
      targetUrl: `/projects/${input.projectId}`,
    })
    .run();

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
