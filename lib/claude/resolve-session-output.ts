import { parseClaudeOutput, isNoTextualOutputFallback } from "./json-parser";
import type { ClaudeResult } from "./spawn";
import type { SessionOutcome } from "@/lib/agent-sessions/lifecycle";
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

/**
 * Deterministically classifies a finished agent run into its delivery verdict.
 *
 * This is the single choke point every dispatch route threads through
 * `markSessionTerminal` so the outcome is persisted for ALL agent paths:
 *
 *   - error:          the run failed (missing result counts as failure)
 *   - asked_question: the agent ended by asking the user a question
 *                     (`endedWithQuestion` is detected by the providers via
 *                     `hasAskUserQuestion` over their output streams)
 *   - answered:       the run produced a textual deliverable, either in the
 *                     final result envelope or streamed via `lastNonEmptyText`
 *   - silent:         success, but no textual deliverable anywhere
 *                     (the NO_TEXTUAL_OUTPUT_FALLBACK-style empty case)
 *
 * The text checks mirror `resolveSessionOutput`'s resolution order so the
 * verdict never disagrees with the output shown to the user.
 */
export function classifySessionOutcome(
  result: ClaudeResult | undefined | null,
  sessionId: string,
): SessionOutcome {
  if (!result?.success) {
    return "error";
  }

  if (result.endedWithQuestion) {
    return "asked_question";
  }

  if (result.result) {
    const parsed = parseClaudeOutput(result.result).content;
    if (parsed && !isNoTextualOutputFallback(parsed)) {
      return "answered";
    }
  }

  if (getLastNonEmptyText(sessionId)) {
    return "answered";
  }

  return "silent";
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
