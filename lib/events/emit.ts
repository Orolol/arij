/**
 * Convenience helpers for emitting events from API routes.
 */

import { eventBus, type TicketEventType } from "./bus";

function emit(
  type: TicketEventType,
  projectId: string,
  epicId: string | undefined,
  data: Record<string, unknown>
) {
  eventBus.emit({
    type,
    projectId,
    epicId,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function emitTicketMoved(
  projectId: string,
  epicId: string,
  fromStatus: string,
  toStatus: string
) {
  emit("ticket:moved", projectId, epicId, { fromStatus, toStatus });
}

export function emitTicketCreated(
  projectId: string,
  epicId: string,
  title: string
) {
  emit("ticket:created", projectId, epicId, { title });
}

export function emitTicketUpdated(
  projectId: string,
  epicId: string,
  fields: Record<string, unknown>
) {
  emit("ticket:updated", projectId, epicId, { fields });
}

export function emitTicketDeleted(projectId: string, epicId: string) {
  emit("ticket:deleted", projectId, epicId, {});
}

/**
 * A dependency edge was added or removed. Without this the board's dependency
 * data has no invalidation path at all — it is only refetched by the
 * whole-board reload that ticket/session events drive.
 *
 * ONE event carrying every affected ticket, not one event per ticket. Both
 * endpoints of every changed edge matter (the board derives blocked state,
 * queue ranking and hover adjacency from the edge list, so a change shows on
 * the dependent and its prerequisite alike) — but the board page maps every
 * `ticket:updated` to a whole-board reload, and SSE messages arrive in separate
 * ticks so React cannot batch them. Per-ticket events turned one edit into N
 * reloads; replacing `[q1]` with `[p1,p2,p3]` cost five. The ids ride in the
 * payload for any consumer that wants them.
 */
export function emitTicketDependenciesChanged(
  projectId: string,
  ticketIds: Iterable<string>
) {
  const affected = [...new Set(ticketIds)];
  if (affected.length === 0) return;
  emit("ticket:updated", projectId, undefined, {
    fields: ["dependencies"],
    ticketIds: affected,
  });
}

export function emitSessionStarted(
  projectId: string,
  epicId: string,
  sessionId: string,
  agentType: string
) {
  emit("session:started", projectId, epicId, { sessionId, agentType });
}

/**
 * A session that belongs to NO ticket — a project-level pass (Dreaming, a
 * memory distillation). `TicketEvent.epicId` is optional, and an empty string
 * would read as a ticket id to any consumer that filters on truthiness, so
 * the field is omitted rather than blanked.
 */
export function emitProjectSessionStarted(
  projectId: string,
  sessionId: string,
  agentType: string,
) {
  emit("session:started", projectId, undefined, { sessionId, agentType });
}

export function emitSessionCompleted(
  projectId: string,
  epicId: string,
  sessionId: string
) {
  emit("session:completed", projectId, epicId, { sessionId });
}

export function emitSessionFailed(
  projectId: string,
  epicId: string,
  sessionId: string,
  error: string
) {
  emit("session:failed", projectId, epicId, { sessionId, error });
}

export function emitSessionArtifactCreated(
  projectId: string,
  epicId: string,
  sessionId: string,
  artifactId: string
) {
  emit("artifact:created", projectId, epicId, { sessionId, artifactId });
}

export function emitReleaseCreated(
  projectId: string,
  releaseId: string,
  version: string,
  epicIds: string[]
) {
  emit("release:created", projectId, undefined, { releaseId, version, epicIds });
}
