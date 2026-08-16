/**
 * Activity logging for ticket state transitions.
 */

import { desc, eq } from "drizzle-orm";
import { db as defaultDb, type ArijDatabase } from "@/lib/db";
import { ticketActivityLog, type TicketActivityLog } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";

export function logTransition(opts: {
  projectId: string;
  epicId: string;
  fromStatus: string;
  toStatus: string;
  actor: "user" | "agent" | "system";
  reason?: string;
  sessionId?: string;
  /**
   * Optional database handle. Defaults to the shared application database;
   * tests inject an isolated in-memory database via `createTestDb()`.
   */
  database?: ArijDatabase;
}) {
  const db = opts.database ?? defaultDb;
  try {
    db.insert(ticketActivityLog)
      .values({
        id: createId(),
        projectId: opts.projectId,
        epicId: opts.epicId,
        fromStatus: opts.fromStatus,
        toStatus: opts.toStatus,
        actor: opts.actor,
        reason: opts.reason ?? null,
        sessionId: opts.sessionId ?? null,
        createdAt: new Date().toISOString(),
      })
      .run();
  } catch (err) {
    console.warn("[logTransition] Failed to log activity:", (err as Error).message);
  }
}

/**
 * All activity-log entries for an epic, newest first.
 *
 * Read counterpart of `logTransition`; consumed by the epic activity API
 * route. Same optional-db convention as `logTransition`.
 */
export function getEpicActivity(opts: {
  epicId: string;
  /**
   * Optional database handle. Defaults to the shared application database;
   * tests inject an isolated in-memory database via `createTestDb()`.
   */
  database?: ArijDatabase;
}): TicketActivityLog[] {
  const db = opts.database ?? defaultDb;
  return db
    .select()
    .from(ticketActivityLog)
    .where(eq(ticketActivityLog.epicId, opts.epicId))
    .orderBy(desc(ticketActivityLog.createdAt))
    .all();
}
