import { sql } from "drizzle-orm";
import { agentSessions } from "@/lib/db/schema";

/**
 * Terminal session time in fixed UTC ISO precision, sortable with MAX/ORDER.
 * Replacing the separator alone misorders fractions and timezone offsets.
 * Keep this a function so SQL is not evaluated at module import time.
 */
export function sessionAtSql() {
  return sql<string | null>`COALESCE(
    strftime('%Y-%m-%dT%H:%M:%fZ', ${agentSessions.endedAt}),
    strftime('%Y-%m-%dT%H:%M:%fZ', ${agentSessions.completedAt}),
    strftime('%Y-%m-%dT%H:%M:%fZ', ${agentSessions.createdAt})
  )`;
}
