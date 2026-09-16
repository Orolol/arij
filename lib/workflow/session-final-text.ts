/**
 * The final text of a finished agent session, as the memory writers read it.
 *
 * Shared by the dream collector and the per-session distill, which used to
 * resolve it in opposite orders — the distill taking the one-line column first
 * and so handing its prompt a single line of a whole report. One resolver, one
 * order, so the two writers cannot drift again.
 *
 * Kept out of dreaming.ts on purpose: the distill only needs this answer, not
 * the dream's dispatch path.
 */
import { readSessionStreamTail } from "@/lib/agent-sessions/chunks";
import { extractLastNonEmptyTextFromFile } from "@/lib/agent-sessions/last-text";
import { tailText } from "./dreaming-digest";

/** The three columns the resolver reads off an `agent_sessions` row. */
export interface FinalTextSource {
  id: string;
  logsPath: string | null;
  lastNonEmptyText: string | null;
}

/**
 * The last `maxChars` characters of a session's final response.
 *
 * Resolution order matters, and the obvious first choice is the wrong one:
 * `agent_sessions.last_non_empty_text` holds only the last non-empty LINE of
 * the newest chunk (see `extractLastNonEmptyText`). Preferring it collapsed a
 * whole review report to one line — and a report's mandated
 * `**Overall Verdict: …**` only survived when it happened to BE that line.
 *
 * So the persisted chunk streams come first:
 *   - `response` — the final assistant text for streaming providers;
 *   - `output` — where Claude Code's result envelope is persisted
 *     (`result-<sessionId>`) and where other providers put their final output;
 *   - the logs file, then the one-line column, only as last resorts.
 *
 * A TAIL rather than the head: a conclusion (and the verdict line) lives at
 * the end of a report, so a cut must drop the preamble, never the verdict.
 */
export function resolveFinalText(
  row: FinalTextSource,
  maxChars: number
): string | null {
  for (const streamType of ["response", "output"] as const) {
    let tail: string | null = null;
    try {
      // Read from the END of the stream and stop once the budget is covered:
      // materialising a whole stream to keep a few thousand characters would
      // block the shared connection on a verbose run.
      tail = readSessionStreamTail(row.id, streamType, maxChars);
    } catch {
      // An unreadable stream falls through to the next source.
    }
    if (tail && tail.trim()) return tail;
  }
  let fallback: string | null = null;
  try {
    fallback = extractLastNonEmptyTextFromFile(row.logsPath);
  } catch {
    // Best-effort: an unreadable log file must not break the caller.
  }
  if (!fallback || !fallback.trim()) {
    fallback = row.lastNonEmptyText;
  }
  if (!fallback || !fallback.trim()) return null;
  return fallback.length > maxChars ? tailText(fallback, maxChars) : fallback;
}
