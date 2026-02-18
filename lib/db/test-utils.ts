import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * SQL statements to create all schema tables in dependency order.
 *
 * Tables are created parents-first so that foreign key references resolve
 * correctly when `PRAGMA foreign_keys = ON`.
 */
const CREATE_TABLES_SQL = `
  -- ===== Level 0: no foreign keys =====

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ideation',
    git_repo_path TEXT,
    github_owner_repo TEXT,
    spec TEXT,
    imported INTEGER DEFAULT 0,
    ticket_counter INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE named_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    readable_agent_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX named_agents_name_unique ON named_agents (name);
  CREATE UNIQUE INDEX named_agents_readable_agent_name_unique ON named_agents (readable_agent_name);

  CREATE TABLE qa_prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX qa_prompts_name_unique ON qa_prompts (name);

  CREATE TABLE agent_prompts (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    scope TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX agent_prompts_agent_type_scope_unique ON agent_prompts (agent_type, scope);

  CREATE TABLE custom_review_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    scope TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX custom_review_agents_name_scope_unique ON custom_review_agents (name, scope);

  -- ===== Level 1: depend on projects / named_agents =====

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    markdown_content TEXT,
    image_path TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX documents_project_filename_unique ON documents (project_id, original_filename);
  CREATE INDEX documents_project_created_at_idx ON documents (project_id, created_at);

  CREATE TABLE epics (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'backlog',
    position INTEGER DEFAULT 0,
    branch_name TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    pr_status TEXT,
    confidence REAL,
    evidence TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    type TEXT DEFAULT 'feature',
    linked_epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
    images TEXT,
    readable_id TEXT
  );

  CREATE TABLE chat_conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'brainstorm',
    label TEXT NOT NULL DEFAULT 'Brainstorm',
    status TEXT DEFAULT 'active',
    epic_id TEXT REFERENCES epics(id),
    provider TEXT DEFAULT 'claude-code',
    claude_session_id TEXT,
    cli_session_id TEXT,
    named_agent_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE releases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    title TEXT,
    changelog TEXT,
    epic_ids TEXT,
    git_tag TEXT,
    github_release_id INTEGER,
    github_release_url TEXT,
    pushed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE git_sync_log (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    branch TEXT,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE agent_provider_defaults (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    named_agent_id TEXT REFERENCES named_agents(id) ON DELETE SET NULL,
    scope TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX agent_provider_defaults_agent_type_scope_unique ON agent_provider_defaults (agent_type, scope);

  -- ===== Level 2: depend on epics =====

  CREATE TABLE user_stories (
    id TEXT PRIMARY KEY,
    epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    status TEXT DEFAULT 'todo',
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE pull_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
    number INTEGER NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    head_branch TEXT NOT NULL,
    base_branch TEXT NOT NULL DEFAULT 'main',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE ticket_dependencies (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    depends_on_ticket_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL DEFAULT 'project',
    scope_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX ticket_dependencies_edge_unique ON ticket_dependencies (ticket_id, depends_on_ticket_id);
  CREATE INDEX ticket_dependencies_ticket_idx ON ticket_dependencies (ticket_id);
  CREATE INDEX ticket_dependencies_depends_on_idx ON ticket_dependencies (depends_on_ticket_id);
  CREATE INDEX ticket_dependencies_project_idx ON ticket_dependencies (project_id);

  -- ===== Level 3: depend on epics + user_stories =====

  CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id TEXT REFERENCES epics(id),
    user_story_id TEXT REFERENCES user_stories(id),
    status TEXT DEFAULT 'queued',
    mode TEXT DEFAULT 'code',
    orchestration_mode TEXT DEFAULT 'solo',
    provider TEXT DEFAULT 'claude-code',
    prompt TEXT,
    logs_path TEXT,
    branch_name TEXT,
    worktree_path TEXT,
    started_at TEXT,
    ended_at TEXT,
    completed_at TEXT,
    last_non_empty_text TEXT,
    error TEXT,
    claude_session_id TEXT,
    cli_session_id TEXT,
    named_agent_id TEXT,
    agent_type TEXT,
    named_agent_name TEXT,
    model TEXT,
    cli_command TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ===== Level 4: depend on agent_sessions / chat_messages =====

  CREATE TABLE agent_session_sequences (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    next_sequence INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE agent_session_chunks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    stream_type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    chunk_key TEXT,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX agent_session_chunks_session_sequence_unique ON agent_session_chunks (session_id, sequence);
  CREATE UNIQUE INDEX agent_session_chunks_session_stream_key_unique ON agent_session_chunks (session_id, stream_type, chunk_key);
  CREATE INDEX agent_session_chunks_session_stream_sequence_idx ON agent_session_chunks (session_id, stream_type, sequence);

  CREATE TABLE ticket_comments (
    id TEXT PRIMARY KEY,
    user_story_id TEXT REFERENCES user_stories(id) ON DELETE CASCADE,
    epic_id TEXT REFERENCES epics(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    agent_session_id TEXT REFERENCES agent_sessions(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE chat_attachments (
    id TEXT PRIMARY KEY,
    chat_message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE qa_reports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running',
    agent_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
    named_agent_id TEXT REFERENCES named_agents(id) ON DELETE SET NULL,
    prompt_used TEXT,
    custom_prompt_id TEXT,
    report_content TEXT,
    summary TEXT,
    check_type TEXT NOT NULL DEFAULT 'tech_check',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  CREATE TABLE review_comments (
    id TEXT PRIMARY KEY,
    epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX review_comments_epic_file_idx ON review_comments (epic_id, file_path);

  -- ===== Level 5: notifications =====

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_name TEXT NOT NULL,
    session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
    agent_type TEXT,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    target_url TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX notifications_created_at_idx ON notifications(created_at);

  CREATE TABLE notification_read_cursor (
    id INTEGER PRIMARY KEY,
    read_at TEXT NOT NULL
  );
`;

/**
 * Creates an isolated in-memory SQLite database with the full Arij schema.
 *
 * Each call returns a fresh `:memory:` database so tests never interfere
 * with each other or with the production data directory.
 *
 * @returns `{ db, sqlite }` where `db` is a Drizzle ORM instance and
 *          `sqlite` is the underlying better-sqlite3 `Database` handle.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
