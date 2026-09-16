import Database from "better-sqlite3";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  chatAttachments,
  chatConversations,
  epics,
  sessionArtifacts,
  ticketComments,
  ticketDependencies,
  userStories,
} from "@/lib/db/schema";
import { removeSessionArtifactDirectories } from "@/lib/agent-sessions/artifacts";
import {
  removeUploadFiles,
  ticketUploadPaths,
} from "@/lib/uploads/attachment-ownership";

export class ScopedDeleteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopedDeleteNotFoundError";
  }
}

function sqliteClient() {
  return (db as unknown as { $client: Database.Database }).$client;
}

export function deleteEpicPermanently(projectId: string, epicId: string) {
  const epic = db
    .select()
    .from(epics)
    .where(and(eq(epics.id, epicId), eq(epics.projectId, projectId)))
    .get();

  if (!epic) {
    throw new ScopedDeleteNotFoundError("Epic not found");
  }

  assertTicketIdle(epicId);

  // Read before the delete, unlink after it commits: the rows carrying these
  // paths are gone by the time the transaction ends, and unlinking first would
  // destroy a bug's screenshots for a delete that then rolled back.
  const uploadPaths = ticketUploadPaths(epicId);

  // Session ids escape the transaction: their visual-proof copies are
  // unlinked after it commits, for the same reason as the upload paths.
  let removedSessionIds: string[] = [];

  const transaction = sqliteClient().transaction(() => {
    const storyIds = db
      .select({ id: userStories.id })
      .from(userStories)
      .where(eq(userStories.epicId, epicId))
      .all()
      .map((row) => row.id);

    const sessions = db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(
        storyIds.length > 0
          ? or(
              eq(agentSessions.epicId, epicId),
              inArray(agentSessions.userStoryId, storyIds),
            )
          : eq(agentSessions.epicId, epicId),
      )
      .all();

    const sessionIds = sessions.map((session) => session.id);
    removedSessionIds = sessionIds;

    if (sessionIds.length > 0) {
      db.delete(ticketComments)
        .where(inArray(ticketComments.agentSessionId, sessionIds))
        .run();
      // Stated, not left to the FK cascade (see chat attachments below).
      db.delete(sessionArtifacts)
        .where(inArray(sessionArtifacts.agentSessionId, sessionIds))
        .run();
      db.delete(agentSessions).where(inArray(agentSessions.id, sessionIds)).run();
    }
    db.delete(sessionArtifacts).where(eq(sessionArtifacts.epicId, epicId)).run();

    if (storyIds.length > 0) {
      db.delete(ticketComments)
        .where(inArray(ticketComments.userStoryId, storyIds))
        .run();
    }

    db.delete(ticketComments).where(eq(ticketComments.epicId, epicId)).run();
    db.delete(chatConversations).where(eq(chatConversations.epicId, epicId)).run();
    // Stated rather than left to the FK cascade, which only fires when
    // `foreign_keys` is ON — the screenshots must go with the ticket whatever
    // the connection's pragma happens to be.
    db.delete(chatAttachments).where(eq(chatAttachments.epicId, epicId)).run();
    db.delete(ticketDependencies).where(or(eq(ticketDependencies.ticketId, epicId), eq(ticketDependencies.dependsOnTicketId, epicId))).run();
    db.delete(userStories).where(eq(userStories.epicId, epicId)).run();
    db.delete(epics).where(eq(epics.id, epicId)).run();
  });

  transaction();

  removeUploadFiles(uploadPaths);
  removeSessionArtifactDirectories(removedSessionIds);
}

export function deleteUserStoryPermanently(projectId: string, storyId: string) {
  const story = db
    .select()
    .from(userStories)
    .where(eq(userStories.id, storyId))
    .get();

  if (!story) {
    throw new ScopedDeleteNotFoundError("Story not found");
  }

  const parentEpic = db
    .select({ id: epics.id })
    .from(epics)
    .where(and(eq(epics.id, story.epicId), eq(epics.projectId, projectId)))
    .get();

  if (!parentEpic) {
    throw new ScopedDeleteNotFoundError("Story not found");
  }

  assertTicketIdle(story.epicId);
  let removedSessionIds: string[] = [];
  const transaction = sqliteClient().transaction(() => {
    const sessions = db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(eq(agentSessions.userStoryId, storyId))
      .all();

    const sessionIds = sessions.map((session) => session.id);
    removedSessionIds = sessionIds;

    if (sessionIds.length > 0) {
      db.delete(ticketComments)
        .where(inArray(ticketComments.agentSessionId, sessionIds))
        .run();
      db.delete(sessionArtifacts)
        .where(inArray(sessionArtifacts.agentSessionId, sessionIds))
        .run();
      db.delete(agentSessions).where(inArray(agentSessions.id, sessionIds)).run();
    }

    db.delete(ticketComments).where(eq(ticketComments.userStoryId, storyId)).run();
    db.delete(userStories).where(eq(userStories.id, storyId)).run();
  });

  transaction();
  removeSessionArtifactDirectories(removedSessionIds);

  return { epicId: story.epicId };
}


/** Deletion must never invalidate a queued or running process's target. */
export function assertTicketIdle(epicId: string): void {
  const storyIds = db.select({ id: userStories.id }).from(userStories).where(eq(userStories.epicId, epicId));
  const projectId = db.select({ projectId: epics.projectId }).from(epics).where(eq(epics.id, epicId));
  const active = db.select({ id: agentSessions.id }).from(agentSessions).where(and(
    inArray(agentSessions.status, ["queued", "running"]),
    or(eq(agentSessions.epicId, epicId), inArray(agentSessions.userStoryId, storyIds), and(inArray(agentSessions.projectId, projectId), eq(agentSessions.agentType, "team_build"))),
  )).get();
  if (active) throw new Error("Cannot delete a ticket with an active session");
}
