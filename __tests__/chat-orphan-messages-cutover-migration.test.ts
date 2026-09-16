import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

/**
 * The unified-chat cutover as the one-shot data migration it always claimed
 * to be. It used to run from GET /conversations behind an in-memory Set, so
 * every new server process replayed it per project and wrote a full JSON
 * backup of that project's chat history each time. As a numbered migration
 * the migrator's own bookkeeping makes it run exactly once per database.
 */
const MIGRATION_TAG = "0064_chat_orphan_messages_cutover";
const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib", "db", "migrations");

function migrationSql(): string {
  return fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${MIGRATION_TAG}.sql`), "utf8");
}

function applyMigration(connection: Database.Database) {
  for (const statement of migrationSql().split("--> statement-breakpoint")) {
    if (statement.trim()) connection.exec(statement);
  }
}

function seed(): Database.Database {
  const connection = new Database(":memory:");
  connection.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE chat_conversations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'brainstorm',
      label TEXT NOT NULL DEFAULT 'Brainstorm',
      status TEXT DEFAULT 'active',
      epic_id TEXT,
      provider TEXT DEFAULT 'claude-code',
      cli_session_id TEXT,
      named_agent_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO projects (id) VALUES ('p-empty'), ('p-convs'), ('p-clean');

    -- Orphans in a project that never had a conversation.
    INSERT INTO chat_messages (id, project_id, conversation_id, role, content, created_at) VALUES
      ('m-empty-2', 'p-empty', NULL, 'assistant', 'hi', '2026-01-02T00:00:00.000Z'),
      ('m-empty-1', 'p-empty', NULL, 'user', 'hello', '2026-01-01T00:00:00.000Z');

    -- Orphans next to existing conversations: they join the oldest one.
    INSERT INTO chat_conversations (id, project_id, type, label, created_at) VALUES
      ('c-newer', 'p-convs', 'chat', 'Chat', '2026-03-01T00:00:00.000Z'),
      ('c-older', 'p-convs', 'brainstorm', 'Brainstorm', '2026-02-01T00:00:00.000Z');
    INSERT INTO chat_messages (id, project_id, conversation_id, role, content, created_at) VALUES
      ('m-convs-orphan', 'p-convs', NULL, 'user', 'lost', '2026-01-05T00:00:00.000Z'),
      ('m-convs-attached', 'p-convs', 'c-newer', 'user', 'kept', '2026-03-02T00:00:00.000Z');

    -- A clean project is left exactly as it is.
    INSERT INTO chat_conversations (id, project_id, created_at) VALUES
      ('c-clean', 'p-clean', '2026-04-01T00:00:00.000Z');
    INSERT INTO chat_messages (id, project_id, conversation_id, role, content) VALUES
      ('m-clean', 'p-clean', 'c-clean', 'user', 'fine');

    -- Orphans of a project row that no longer exists get no conversation:
    -- one would violate the projects foreign key on a real database.
    INSERT INTO chat_messages (id, project_id, conversation_id, role, content) VALUES
      ('m-ghost', 'p-gone', NULL, 'user', 'ghost');
  `);
  return connection;
}

function conversationOf(connection: Database.Database, messageId: string) {
  return (
    connection
      .prepare("SELECT conversation_id AS id FROM chat_messages WHERE id = ?")
      .get(messageId) as { id: string | null }
  ).id;
}

describe(MIGRATION_TAG, () => {
  it("opens one brainstorm conversation for a project whose messages have none", () => {
    const connection = seed();
    applyMigration(connection);

    const created = connection
      .prepare("SELECT * FROM chat_conversations WHERE project_id = 'p-empty'")
      .all() as Array<Record<string, unknown>>;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: "brainstorm",
      label: "Brainstorm",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(conversationOf(connection, "m-empty-1")).toBe(created[0].id);
    expect(conversationOf(connection, "m-empty-2")).toBe(created[0].id);
    connection.close();
  });

  it("dates an undated orphan's conversation in the app's ISO format", () => {
    const connection = seed();
    connection.exec(`
      INSERT INTO projects (id) VALUES ('p-undated');
      INSERT INTO chat_messages (id, project_id, conversation_id, role, content, created_at)
        VALUES ('m-undated', 'p-undated', NULL, 'user', 'when?', NULL);
    `);
    applyMigration(connection);

    const created = connection
      .prepare("SELECT created_at FROM chat_conversations WHERE project_id = 'p-undated'")
      .get() as { created_at: string };
    // CURRENT_TIMESTAMP's 'YYYY-MM-DD HH:MM:SS' sorts before every ISO value
    // of the same day, putting this conversation out of order.
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    connection.close();
  });

  it("attaches orphans to the project's oldest conversation and touches nothing else", () => {
    const connection = seed();
    applyMigration(connection);

    expect(conversationOf(connection, "m-convs-orphan")).toBe("c-older");
    expect(conversationOf(connection, "m-convs-attached")).toBe("c-newer");
    expect(conversationOf(connection, "m-clean")).toBe("c-clean");
    expect(
      connection
        .prepare("SELECT count(*) AS n FROM chat_conversations WHERE project_id IN ('p-convs', 'p-clean')")
        .get()
    ).toEqual({ n: 3 });
    connection.close();
  });

  it("leaves the orphans of a deleted project alone", () => {
    const connection = seed();
    applyMigration(connection);

    expect(conversationOf(connection, "m-ghost")).toBeNull();
    expect(
      connection.prepare("SELECT count(*) AS n FROM chat_conversations WHERE project_id = 'p-gone'").get()
    ).toEqual({ n: 0 });
    connection.close();
  });

  it("is a no-op when replayed", () => {
    const connection = seed();
    applyMigration(connection);
    const snapshot = () => ({
      conversations: connection.prepare("SELECT * FROM chat_conversations ORDER BY id").all(),
      messages: connection.prepare("SELECT * FROM chat_messages ORDER BY id").all(),
    });
    const once = snapshot();
    applyMigration(connection);
    expect(snapshot()).toEqual(once);
    connection.close();
  });

  it("is registered after the migration preceding it", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const position = journal.entries.findIndex((item) => item.tag === MIGRATION_TAG);
    const entry = journal.entries[position];
    const previous = position > 0 ? journal.entries[position - 1] : undefined;

    expect(entry).toBeDefined();
    expect(entry.idx).toBe((previous?.idx ?? -1) + 1);
    expect(entry.when).toBeGreaterThan(previous?.when ?? 0);
    for (const later of journal.entries.slice(position + 1)) {
      expect(later.when).toBeGreaterThan(entry.when);
    }
  });

  it("replaces the request-time replay: no route or boot path runs the old module", () => {
    expect(fs.existsSync(path.join(process.cwd(), "lib", "chat", "unified-cutover-migration.ts"))).toBe(false);
    const route = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "projects", "[projectId]", "conversations", "route.ts"),
      "utf8"
    );
    expect(route).not.toMatch(/cutover/i);
  });
});
