import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { createTestDb } from "@/lib/db/test-utils";

/**
 * Builds a real in-memory database from the actual drizzle migration chain
 * (lib/db/test-utils), so the fixture can never drift from the production
 * schema the way the previous hand-maintained DDL did. Both projects are
 * seeded up front because epics/agent_sessions/chat_conversations carry
 * NOT NULL foreign keys to projects.
 */
function createInMemoryDb() {
  const { sqlite } = createTestDb();
  sqlite.exec(`
    INSERT INTO projects (id, name) VALUES
      ('proj-1', 'Project 1'),
      ('proj-2', 'Project 2');
  `);
  return sqlite;
}

async function loadDeleteModule(sqlite: Database.Database) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({
    db: drizzle(sqlite, { schema }),
  }));

  return import("@/lib/planning/permanent-delete");
}

function rowCount(sqlite: Database.Database, table: string) {
  return sqlite.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
}

function scopedCount(sqlite: Database.Database, query: string, ...params: unknown[]) {
  return sqlite.prepare(query).get(...params) as { count: number };
}

describe("permanent deletes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("epic delete removes child stories and dependent planning artifacts", async () => {
    const sqlite = createInMemoryDb();
    sqlite.exec(`
      INSERT INTO epics (id, project_id, title) VALUES
        ('epic-1', 'proj-1', 'Epic 1'),
        ('epic-2', 'proj-1', 'Epic 2');

      INSERT INTO user_stories (id, epic_id, title) VALUES
        ('story-1', 'epic-1', 'Story 1'),
        ('story-2', 'epic-1', 'Story 2'),
        ('story-3', 'epic-2', 'Story 3');

      INSERT INTO agent_sessions (id, project_id, epic_id, user_story_id) VALUES
        ('sess-epic-1', 'proj-1', 'epic-1', NULL),
        ('sess-story-1', 'proj-1', NULL, 'story-1'),
        ('sess-epic-2', 'proj-1', 'epic-2', NULL);

      INSERT INTO ticket_comments (id, epic_id, user_story_id, author, content, agent_session_id) VALUES
        ('comment-1', 'epic-1', NULL, 'user', 'epic comment', NULL),
        ('comment-2', NULL, 'story-1', 'user', 'story comment', NULL),
        ('comment-3', NULL, NULL, 'agent', 'session comment', 'sess-epic-1'),
        ('comment-4', 'epic-2', NULL, 'user', 'keep', NULL);

      INSERT INTO chat_conversations (id, project_id, type, label, epic_id) VALUES
        ('conv-1', 'proj-1', 'epic_creation', 'Epic 1', 'epic-1'),
        ('conv-2', 'proj-1', 'epic_creation', 'Epic 2', 'epic-2');
    `);

    const { deleteEpicPermanently } = await loadDeleteModule(sqlite);
    deleteEpicPermanently("proj-1", "epic-1");

    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM epics WHERE id = ?", "epic-1").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM epics WHERE id = ?", "epic-2").count).toBe(1);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM user_stories WHERE epic_id = ?", "epic-1").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM user_stories WHERE epic_id = ?", "epic-2").count).toBe(1);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM agent_sessions WHERE id IN ('sess-epic-1', 'sess-story-1')").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM agent_sessions WHERE id = 'sess-epic-2'").count).toBe(1);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM ticket_comments WHERE id IN ('comment-1', 'comment-2', 'comment-3')").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM ticket_comments WHERE id = 'comment-4'").count).toBe(1);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM chat_conversations WHERE id = 'conv-1'").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM chat_conversations WHERE id = 'conv-2'").count).toBe(1);
  });

  it("epic delete enforces project scoping", async () => {
    const sqlite = createInMemoryDb();
    sqlite.exec(`
      INSERT INTO epics (id, project_id, title) VALUES ('epic-1', 'proj-2', 'Epic 1');
    `);

    const { deleteEpicPermanently, ScopedDeleteNotFoundError } = await loadDeleteModule(sqlite);

    expect(() => deleteEpicPermanently("proj-1", "epic-1")).toThrow(ScopedDeleteNotFoundError);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM epics WHERE id = 'epic-1'").count).toBe(1);
  });

  it("epic delete is atomic when the final delete fails", async () => {
    const sqlite = createInMemoryDb();
    sqlite.exec(`
      INSERT INTO epics (id, project_id, title) VALUES ('epic-1', 'proj-1', 'Epic 1');
      INSERT INTO user_stories (id, epic_id, title) VALUES ('story-1', 'epic-1', 'Story 1');
      INSERT INTO agent_sessions (id, project_id, epic_id, user_story_id) VALUES ('sess-1', 'proj-1', 'epic-1', NULL);
      INSERT INTO ticket_comments (id, epic_id, user_story_id, author, content, agent_session_id) VALUES
        ('comment-1', 'epic-1', NULL, 'user', 'hello', NULL),
        ('comment-2', NULL, NULL, 'agent', 'session', 'sess-1');
      INSERT INTO chat_conversations (id, project_id, type, label, epic_id) VALUES
        ('conv-1', 'proj-1', 'epic_creation', 'Epic 1', 'epic-1');

      CREATE TRIGGER fail_epic_delete
      BEFORE DELETE ON epics
      BEGIN
        SELECT RAISE(FAIL, 'epic-delete-blocked');
      END;
    `);

    const { deleteEpicPermanently } = await loadDeleteModule(sqlite);

    expect(() => deleteEpicPermanently("proj-1", "epic-1")).toThrow("epic-delete-blocked");
    expect(rowCount(sqlite, "epics").count).toBe(1);
    expect(rowCount(sqlite, "user_stories").count).toBe(1);
    expect(rowCount(sqlite, "agent_sessions").count).toBe(1);
    expect(rowCount(sqlite, "ticket_comments").count).toBe(2);
    expect(rowCount(sqlite, "chat_conversations").count).toBe(1);
  });

  it("story delete removes story-scoped dependent records", async () => {
    const sqlite = createInMemoryDb();
    sqlite.exec(`
      INSERT INTO epics (id, project_id, title) VALUES ('epic-1', 'proj-1', 'Epic 1');
      INSERT INTO user_stories (id, epic_id, title) VALUES
        ('story-1', 'epic-1', 'Story 1'),
        ('story-2', 'epic-1', 'Story 2');

      INSERT INTO agent_sessions (id, project_id, epic_id, user_story_id) VALUES
        ('sess-story-1', 'proj-1', NULL, 'story-1'),
        ('sess-story-2', 'proj-1', NULL, 'story-2');

      INSERT INTO ticket_comments (id, epic_id, user_story_id, author, content, agent_session_id) VALUES
        ('comment-1', NULL, 'story-1', 'user', 'story 1', NULL),
        ('comment-2', NULL, NULL, 'agent', 'session story 1', 'sess-story-1'),
        ('comment-3', NULL, 'story-2', 'user', 'story 2', NULL);
    `);

    const { deleteUserStoryPermanently } = await loadDeleteModule(sqlite);
    const result = deleteUserStoryPermanently("proj-1", "story-1");

    expect(result.epicId).toBe("epic-1");
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM user_stories WHERE id = 'story-1'").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM user_stories WHERE id = 'story-2'").count).toBe(1);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM agent_sessions WHERE id = 'sess-story-1'").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM agent_sessions WHERE id = 'sess-story-2'").count).toBe(1);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM ticket_comments WHERE id IN ('comment-1', 'comment-2')").count).toBe(0);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM ticket_comments WHERE id = 'comment-3'").count).toBe(1);
    expect(scopedCount(sqlite, "SELECT COUNT(*) as count FROM epics WHERE id = 'epic-1'").count).toBe(1);
  });

  it("story delete enforces project scoping", async () => {
    const sqlite = createInMemoryDb();
    sqlite.exec(`
      INSERT INTO epics (id, project_id, title) VALUES ('epic-1', 'proj-2', 'Epic 1');
      INSERT INTO user_stories (id, epic_id, title) VALUES ('story-1', 'epic-1', 'Story 1');
    `);

    const { deleteUserStoryPermanently, ScopedDeleteNotFoundError } = await loadDeleteModule(sqlite);

    expect(() => deleteUserStoryPermanently("proj-1", "story-1")).toThrow(ScopedDeleteNotFoundError);
    expect(rowCount(sqlite, "user_stories").count).toBe(1);
  });

  it("story delete is atomic when story removal fails", async () => {
    const sqlite = createInMemoryDb();
    sqlite.exec(`
      INSERT INTO epics (id, project_id, title) VALUES ('epic-1', 'proj-1', 'Epic 1');
      INSERT INTO user_stories (id, epic_id, title) VALUES ('story-1', 'epic-1', 'Story 1');
      INSERT INTO agent_sessions (id, project_id, epic_id, user_story_id) VALUES ('sess-1', 'proj-1', NULL, 'story-1');
      INSERT INTO ticket_comments (id, epic_id, user_story_id, author, content, agent_session_id) VALUES
        ('comment-1', NULL, 'story-1', 'user', 'hello', NULL),
        ('comment-2', NULL, NULL, 'agent', 'session', 'sess-1');

      CREATE TRIGGER fail_story_delete
      BEFORE DELETE ON user_stories
      BEGIN
        SELECT RAISE(FAIL, 'story-delete-blocked');
      END;
    `);

    const { deleteUserStoryPermanently } = await loadDeleteModule(sqlite);

    expect(() => deleteUserStoryPermanently("proj-1", "story-1")).toThrow("story-delete-blocked");
    expect(rowCount(sqlite, "user_stories").count).toBe(1);
    expect(rowCount(sqlite, "agent_sessions").count).toBe(1);
    expect(rowCount(sqlite, "ticket_comments").count).toBe(2);
  });
});
