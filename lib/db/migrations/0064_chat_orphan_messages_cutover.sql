-- The unified-chat cutover: every chat message belongs to a conversation.
--
-- Its `when` is above 0061-0063 (review dismissal, lot 11's release
-- published_at, lot 07's tool-call index): drizzle applies only a `when`
-- above the last one a database recorded, so the order is what counts.
--
-- Messages written before conversations existed carry conversation_id NULL.
-- This pass used to live in lib/chat/unified-cutover-migration.ts and ran from
-- GET /api/projects/:id/conversations behind an in-memory Set, so each new
-- server process replayed it for every project it listed and wrote a full JSON
-- backup of that project's chat history (data/migrations/unified-chat-cutover)
-- every time — hundreds of backups, none of which ever reassigned a message.
-- As a numbered migration it runs once per database, and it needs no backup:
-- it only fills NULL references, it never rewrites or deletes a row.
--
-- 1. A project with orphan messages and no conversation at all gets one
--    brainstorm conversation, dated like its oldest orphan. Deterministic id,
--    so a replay cannot open a second one. Orphans of a project row that no
--    longer exists get nothing: the conversation would break the projects FK.
INSERT INTO chat_conversations (id, project_id, type, label, status, provider, created_at)
SELECT
  'cutover-' || m.project_id,
  m.project_id,
  'brainstorm',
  'Brainstorm',
  'active',
  'claude-code',
  -- ISO like every created_at the app writes; CURRENT_TIMESTAMP's
  -- 'YYYY-MM-DD HH:MM:SS' would sort out of place among them.
  COALESCE(MIN(m.created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM chat_messages m
WHERE m.conversation_id IS NULL
  AND EXISTS (SELECT 1 FROM projects p WHERE p.id = m.project_id)
  AND NOT EXISTS (SELECT 1 FROM chat_conversations c WHERE c.project_id = m.project_id)
GROUP BY m.project_id;
--> statement-breakpoint
-- 2. Every orphan joins its project's oldest conversation (the one step 1 just
--    opened, when there was none).
UPDATE chat_messages
SET conversation_id = (
  SELECT c.id
  FROM chat_conversations c
  WHERE c.project_id = chat_messages.project_id
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1
)
WHERE conversation_id IS NULL
  AND EXISTS (SELECT 1 FROM chat_conversations c WHERE c.project_id = chat_messages.project_id);
