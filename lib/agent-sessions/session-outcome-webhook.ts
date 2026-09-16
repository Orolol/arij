/**
 * Terminal-session webhooks — the outbound signal that survives the removal
 * of the notifications table.
 *
 * The session's own row is the durable state (the desk reads it); what a
 * project webhook adds is a push for receivers outside Arij (ntfy, Discord,
 * Slack-style). It is emitted from the SAME choke point the notification used
 * to hang off — the session terminal hook
 * (lib/agent-sessions/terminal-hooks.ts), which every finalization path runs
 * through — so a session finalized by a closure that died first (scheduler
 * safety net, boot cleanup, engines) still reaches the receiver.
 *
 * Cancelled sessions are silent: the webhook vocabulary is
 * `session.completed` / `session.failed`, and a cancel is neither.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentSessions, epics } from "@/lib/db/schema";
import { durationMsBetween, sendProjectWebhook } from "@/lib/webhooks/send";
import type { SessionTerminalEvent } from "./terminal-hooks";

/**
 * QA report sessions deep-link to the project's QA tab; everything else to
 * the session detail. Same rule the removed notification's `buildTargetUrl`
 * used, because the receiver's link must land where the user can act.
 */
function sessionPath(
  projectId: string,
  sessionId: string,
  agentType: string | null,
): string {
  if (
    agentType === "tech_check" ||
    agentType === "e2e_test" ||
    agentType === "failure_digest"
  ) {
    return `/projects/${projectId}/qa`;
  }
  return `/projects/${projectId}/sessions/${sessionId}`;
}

/** Fire-and-forget: `sendProjectWebhook` never throws. */
export function sendTerminalSessionWebhook(event: SessionTerminalEvent): void {
  if (event.status === "cancelled") return;

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, event.sessionId))
    .get();
  if (!session) return;

  const epic = session.epicId
    ? db
        .select({ title: epics.title })
        .from(epics)
        .where(eq(epics.id, session.epicId))
        .get()
    : undefined;

  const failed = event.status === "failed";
  void sendProjectWebhook(session.projectId, {
    event: failed ? "session.failed" : "session.completed",
    ticketTitle: epic?.title ?? null,
    epicId: session.epicId,
    sessionId: session.id,
    durationMs: durationMsBetween(session.startedAt, session.endedAt),
    error: failed ? session.error : null,
    path: sessionPath(session.projectId, session.id, session.agentType),
  });
}
