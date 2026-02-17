/**
 * Backfill: fix ticket comments and chat messages that contain raw opencode
 * JSON events instead of extracted text content.
 *
 * OpenCode emits NDJSON events like:
 *   {"type":"step_start","part":{...}}
 *   {"type":"text","part":{"type":"text","text":"actual content here"}}
 *   {"type":"step_finish","part":{...}}
 *
 * Previously, the parser stored these raw JSON lines instead of extracting
 * the text from part.text. This backfill re-extracts the text and updates
 * affected rows.
 *
 * Idempotent: rows already containing plain text are left untouched.
 */

import type Database from "better-sqlite3";

/** Pattern that detects raw opencode JSON in content. */
const OPENCODE_JSON_PATTERN =
  /^\s*\{"type"\s*:\s*"(?:step_start|text|step_finish)"/m;

/**
 * Extract text content from raw opencode NDJSON output.
 * Returns null if the input doesn't look like opencode JSON.
 */
function extractOpenCodeText(raw: string): string | null {
  if (!OPENCODE_JSON_PATTERN.test(raw)) return null;

  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed);
      const part = event.part;
      if (part && typeof part === "object" && typeof part.text === "string") {
        parts.push(part.text);
      } else if (typeof event.text === "string" && event.type !== "text") {
        // Top-level text field (but not when type is "text" with part structure)
        parts.push(event.text);
      }
    } catch {
      // skip malformed lines
    }
  }

  if (parts.length === 0) return null;
  return parts.join("");
}

interface BackfillResult {
  commentsFixed: number;
  messagesFixed: number;
  sessionsFixed: number;
  chunksFixed: number;
  qaReportsFixed: number;
}

export function backfillOpenCodeJson(db: Database.Database): BackfillResult {
  const result: BackfillResult = { commentsFixed: 0, messagesFixed: 0, sessionsFixed: 0, chunksFixed: 0, qaReportsFixed: 0 };

  // --- Fix ticket_comments ---
  const comments = db
    .prepare("SELECT id, content FROM ticket_comments WHERE content LIKE '%step_start%' OR content LIKE '%step_finish%'")
    .all() as Array<{ id: string; content: string }>;

  const updateComment = db.prepare(
    "UPDATE ticket_comments SET content = ? WHERE id = ?"
  );

  for (const row of comments) {
    const extracted = extractOpenCodeText(row.content);
    if (extracted && extracted !== row.content) {
      updateComment.run(extracted, row.id);
      result.commentsFixed++;
    }
  }

  // --- Fix chat_messages (assistant role only — user messages are plain text) ---
  const messages = db
    .prepare("SELECT id, content FROM chat_messages WHERE role = 'assistant' AND (content LIKE '%step_start%' OR content LIKE '%step_finish%')")
    .all() as Array<{ id: string; content: string }>;

  const updateMessage = db.prepare(
    "UPDATE chat_messages SET content = ? WHERE id = ?"
  );

  for (const row of messages) {
    const extracted = extractOpenCodeText(row.content);
    if (extracted && extracted !== row.content) {
      updateMessage.run(extracted, row.id);
      result.messagesFixed++;
    }
  }

  // --- Fix agent_sessions.last_non_empty_text ---
  const sessions = db
    .prepare("SELECT id, last_non_empty_text FROM agent_sessions WHERE last_non_empty_text LIKE '%step_start%' OR last_non_empty_text LIKE '%step_finish%'")
    .all() as Array<{ id: string; last_non_empty_text: string }>;

  const updateSession = db.prepare(
    "UPDATE agent_sessions SET last_non_empty_text = ? WHERE id = ?"
  );

  for (const row of sessions) {
    const extracted = extractOpenCodeText(row.last_non_empty_text);
    if (extracted && extracted !== row.last_non_empty_text) {
      updateSession.run(extracted, row.id);
      result.sessionsFixed++;
    }
  }

  // --- Fix qa_reports (reportContent + summary) ---
  const qaReports = db
    .prepare("SELECT id, report_content, summary FROM qa_reports WHERE report_content LIKE '%step_start%' OR report_content LIKE '%step_finish%'")
    .all() as Array<{ id: string; report_content: string | null; summary: string | null }>;

  const updateQaReport = db.prepare(
    "UPDATE qa_reports SET report_content = ?, summary = ? WHERE id = ?"
  );

  for (const row of qaReports) {
    if (!row.report_content) continue;
    const extracted = extractOpenCodeText(row.report_content);
    if (extracted && extracted !== row.report_content) {
      // Replicate extractSummary logic from qa/check route
      const paragraphs = extracted
        .trim()
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && !p.startsWith("#"));
      const newSummary = paragraphs.length > 0
        ? paragraphs[0].slice(0, 500)
        : extracted.trim().slice(0, 500);
      updateQaReport.run(extracted, newSummary, row.id);
      result.qaReportsFixed++;
    }
  }

  // --- Fix agent_session_chunks (output/response streams only, not raw) ---
  const chunks = db
    .prepare("SELECT id, content FROM agent_session_chunks WHERE stream_type IN ('output', 'response') AND (content LIKE '%step_start%' OR content LIKE '%step_finish%')")
    .all() as Array<{ id: string; content: string }>;

  const updateChunk = db.prepare(
    "UPDATE agent_session_chunks SET content = ? WHERE id = ?"
  );

  for (const row of chunks) {
    const extracted = extractOpenCodeText(row.content);
    if (extracted && extracted !== row.content) {
      updateChunk.run(extracted, row.id);
      result.chunksFixed++;
    }
  }

  return result;
}
