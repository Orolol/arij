import { parseClaudeOutput, isNoTextualOutputFallback } from "./json-parser";
import type { ClaudeResult } from "./spawn";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolves the best available text output for a completed agent session.
 *
 * The resolution order is:
 * 1. Parse `result.result` via `parseClaudeOutput()` — works when the agent
 *    produced a final text message.
 * 2. If the parsed output is one of the "no textual output" fallback messages,
 *    look up `lastNonEmptyText` from the `agent_sessions` table — this field
 *    is populated by streaming chunks (non-CC providers) or by the process
 *    manager's result-chunk persistence (CC provider).
 * 3. Fall back to `result.error` or a generic default message.
 */
export function resolveSessionOutput(
  result: ClaudeResult | undefined | null,
  sessionId: string,
  defaultMessage = "Agent session completed without output.",
): string {
  // Try parsing the raw CLI output
  if (result?.result) {
    const parsed = parseClaudeOutput(result.result).content;
    if (parsed && !isNoTextualOutputFallback(parsed)) {
      return parsed;
    }
  }

  // Try lastNonEmptyText from DB
  const lastText = getLastNonEmptyText(sessionId);
  if (lastText) {
    return lastText;
  }

  // Fall back to error or default
  return result?.error || defaultMessage;
}

function getLastNonEmptyText(sessionId: string): string | null {
  try {
    const row = db
      .select({ lastNonEmptyText: agentSessions.lastNonEmptyText })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    return row?.lastNonEmptyText ?? null;
  } catch {
    return null;
  }
}
