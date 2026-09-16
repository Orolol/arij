import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initDb } from "@/lib/db/init";
import * as schema from "@/lib/db/schema";
import { findChatEpicProposal } from "@/lib/chat/epic-proposals";

function seed(connection: Database.Database) {
  connection.exec(`
    INSERT INTO projects (id, name) VALUES ('project', 'Existing project');
    INSERT INTO chat_conversations (id, project_id) VALUES ('conversation', 'project');
    INSERT INTO epics (id, project_id, title) VALUES ('epic', 'project', 'Existing epic');
    INSERT INTO user_stories (id, epic_id, title) VALUES ('story', 'epic', 'Existing story');
  `);
}
function claim(connection: Database.Database) {
  connection.exec("INSERT INTO chat_epic_proposals (project_id, conversation_id, proposal_hash, epic_id, user_stories_created) VALUES ('project', 'conversation', 'hash', 'epic', 1);");
}
const identity = { projectId: "project", conversationId: "conversation", proposalHash: "hash" };

describe("0057 chat epic proposal ledger", () => {
  it("upgrades an existing database and retains the claim across reopening", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arij-chat-proposal-"));
    const filename = path.join(dir, "database.sqlite");
    let connection = new Database(filename);
    try {
      initDb(connection);
      // The schema and migration high-water mark of an installation at 0056.
      connection.exec("ALTER TABLE review_comments DROP COLUMN dismissed_reason; DROP TABLE chat_epic_proposals; DELETE FROM __drizzle_migrations WHERE created_at >= 1786715400000;");
      seed(connection);
      connection.close();
      connection = new Database(filename);
      connection.pragma("foreign_keys = ON");
      initDb(connection);
      expect(connection.prepare("SELECT title FROM user_stories WHERE id = 'story'").get()).toEqual({ title: "Existing story" });
      claim(connection);
      connection.close();
      connection = new Database(filename);
      connection.pragma("foreign_keys = ON");
      initDb(connection);
      expect(findChatEpicProposal(drizzle(connection, { schema }), identity)).toMatchObject({ id: "epic", userStoriesCreated: 1 });
      expect(() => claim(connection)).toThrow(/UNIQUE constraint/);
      connection.exec("DELETE FROM epics WHERE id = 'epic';");
      expect(connection.prepare("SELECT epic_id FROM chat_epic_proposals").get()).toEqual({ epic_id: null });
      expect(() => findChatEpicProposal(drizzle(connection, { schema }), identity)).toThrow(/was deleted/);
      connection.exec("DELETE FROM chat_conversations WHERE id = 'conversation';");
      expect(connection.prepare("SELECT * FROM chat_epic_proposals").all()).toEqual([]);
      expect(connection.pragma("foreign_key_check")).toEqual([]);
    } finally {
      if (connection.open) connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves the ledger when a legacy database has no migration bookkeeping", () => {
    const connection = new Database(":memory:");
    try {
      connection.pragma("foreign_keys = ON");
      initDb(connection);
      seed(connection);
      claim(connection);
      connection.exec("DROP TABLE __drizzle_migrations;");
      initDb(connection);
      expect(findChatEpicProposal(drizzle(connection, { schema }), identity)).toMatchObject({ id: "epic", userStoriesCreated: 1 });
      connection.exec("DELETE FROM projects WHERE id = 'project';");
      expect(connection.prepare("SELECT * FROM chat_epic_proposals").all()).toEqual([]);
      expect(connection.pragma("foreign_key_check")).toEqual([]);
    } finally {
      connection.close();
    }
  });
});
