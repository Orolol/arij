/**
 * Activity logging for ticket state transitions.
 */

import { db } from "@/lib/db";
import { ticketActivityLog } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";

export function logTransition(opts: {
  projectId: string;
  epicId: string;
  fromStatus: string;
  toStatus: string;
  actor: "user" | "agent" | "system";
  reason?: string;
  sessionId?: string;
}) {
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
