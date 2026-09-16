import { sql, inArray, type SQL } from "drizzle-orm";
import { qaReports, agentSessions } from "@/lib/db/schema";
import { NON_TERMINAL_STATUSES } from "@/lib/agent-sessions/lifecycle-status";

/**
 * 1 when this `qa_reports` row is a check that is genuinely still going.
 *
 * The SQL twin of `isCheckLive` (`lib/qa/aggregate.ts`), and it must stay a
 * twin: the ordering, the row flag and the totals all read this one expression,
 * and a JavaScript answer that disagreed with the SQL one would sort the band
 * by a different rule than it paints it by. Requires the `agent_sessions` LEFT
 * JOIN to be in scope; a `NULL` session status fails the `IN` and yields `0`,
 * which is the wanted answer for a report whose session is gone.
 */
export function liveCheckSql(): SQL<number> {
  return sql<number>`CASE WHEN COALESCE(${qaReports.status}, 'running') = 'running'
    AND ${inArray(agentSessions.status, [...NON_TERMINAL_STATUSES])}
    THEN 1 ELSE 0 END`;
}
