import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";

// Mock the db module BEFORE importing identity to prevent production DB access
vi.mock("@/lib/db", () => ({
  db: null,
  sqlite: null,
}));

import { GREEK_NAMES } from "@/lib/identity";

let db: BetterSQLite3Database<typeof schema>;
let sqlite: Database.Database;

beforeEach(() => {
  ({ db, sqlite } = createTestDb());
});

describe("Ancient Greek name registry", () => {
  it("has at least 70 unique names", () => {
    expect(GREEK_NAMES.length).toBeGreaterThanOrEqual(70);
    const uniqueNames = new Set(GREEK_NAMES);
    expect(uniqueNames.size).toBe(GREEK_NAMES.length);
  });

  it("all names are non-empty strings", () => {
    for (const name of GREEK_NAMES) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("readable_agent_name column", () => {
  it("stores readable name on named_agents table", () => {
    sqlite.exec(`
      INSERT INTO named_agents (id, name, provider, model, readable_agent_name)
      VALUES ('a1', 'Agent 1', 'claude-code', 'claude-opus-4-6', 'Athena');
    `);

    const row = sqlite
      .prepare("SELECT readable_agent_name FROM named_agents WHERE id = ?")
      .get("a1") as { readable_agent_name: string };

    expect(row.readable_agent_name).toBe("Athena");
  });

  it("enforces uniqueness on readable_agent_name", () => {
    sqlite.exec(`
      INSERT INTO named_agents (id, name, provider, model, readable_agent_name)
      VALUES ('a1', 'Agent 1', 'claude-code', 'claude-opus-4-6', 'Athena');
    `);

    expect(() => {
      sqlite.exec(`
        INSERT INTO named_agents (id, name, provider, model, readable_agent_name)
        VALUES ('a2', 'Agent 2', 'claude-code', 'claude-opus-4-6', 'Athena');
      `);
    }).toThrow();
  });

  it("allows null readable_agent_name (for unassigned agents)", () => {
    sqlite.exec(`
      INSERT INTO named_agents (id, name, provider, model, readable_agent_name)
      VALUES ('a1', 'Agent 1', 'claude-code', 'claude-opus-4-6', NULL);
      INSERT INTO named_agents (id, name, provider, model, readable_agent_name)
      VALUES ('a2', 'Agent 2', 'claude-code', 'claude-opus-4-6', NULL);
    `);

    const count = sqlite
      .prepare("SELECT COUNT(*) as cnt FROM named_agents WHERE readable_agent_name IS NULL")
      .get() as { cnt: number };

    expect(count.cnt).toBe(2);
  });
});
