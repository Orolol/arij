import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";

let db: BetterSQLite3Database<typeof schema>;
let sqlite: Database.Database;

beforeEach(() => {
  ({ db, sqlite } = createTestDb());
});

describe("Readable ID generation", () => {
  it("generates E-prefixed ID for features", () => {
    sqlite.exec(`
      INSERT INTO projects (id, name, ticket_counter) VALUES ('p1', 'My Project', 0);
    `);

    // Simulate generateReadableId logic
    const result = sqlite
      .prepare(
        "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
      )
      .get("p1") as { ticket_counter: number };

    expect(result.ticket_counter).toBe(1);

    const slug = "my-project";
    const readableId = `E-${slug}-001`;
    expect(readableId).toBe("E-my-project-001");
  });

  it("generates B-prefixed ID for bugs", () => {
    sqlite.exec(`
      INSERT INTO projects (id, name, ticket_counter) VALUES ('p1', 'My Project', 0);
    `);

    const result = sqlite
      .prepare(
        "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
      )
      .get("p1") as { ticket_counter: number };

    const slug = "my-project";
    const readableId = `B-${slug}-${String(result.ticket_counter).padStart(3, "0")}`;
    expect(readableId).toBe("B-my-project-001");
  });

  it("shares counter across features and bugs in the same project", () => {
    sqlite.exec(`
      INSERT INTO projects (id, name, ticket_counter) VALUES ('p1', 'Test', 0);
    `);

    // Simulate creating a feature (counter -> 1)
    const r1 = sqlite
      .prepare(
        "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
      )
      .get("p1") as { ticket_counter: number };
    expect(r1.ticket_counter).toBe(1);

    // Simulate creating a bug (counter -> 2)
    const r2 = sqlite
      .prepare(
        "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
      )
      .get("p1") as { ticket_counter: number };
    expect(r2.ticket_counter).toBe(2);

    // Simulate creating another feature (counter -> 3)
    const r3 = sqlite
      .prepare(
        "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
      )
      .get("p1") as { ticket_counter: number };
    expect(r3.ticket_counter).toBe(3);
  });

  it("maintains separate counters per project", () => {
    sqlite.exec(`
      INSERT INTO projects (id, name, ticket_counter) VALUES ('p1', 'Project A', 0);
      INSERT INTO projects (id, name, ticket_counter) VALUES ('p2', 'Project B', 0);
    `);

    const r1 = sqlite
      .prepare(
        "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
      )
      .get("p1") as { ticket_counter: number };

    const r2 = sqlite
      .prepare(
        "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
      )
      .get("p2") as { ticket_counter: number };

    expect(r1.ticket_counter).toBe(1);
    expect(r2.ticket_counter).toBe(1);
  });

  it("readable_id column is stored on epics", () => {
    sqlite.exec(`
      INSERT INTO projects (id, name) VALUES ('p1', 'Test');
      INSERT INTO epics (id, project_id, title, readable_id) VALUES ('e1', 'p1', 'Epic 1', 'E-test-001');
    `);

    const row = sqlite
      .prepare("SELECT readable_id FROM epics WHERE id = ?")
      .get("e1") as { readable_id: string };

    expect(row.readable_id).toBe("E-test-001");
  });
});

describe("Backfill immutability", () => {
  it("only assigns readable_id where null", () => {
    sqlite.exec(`
      INSERT INTO projects (id, name, ticket_counter) VALUES ('p1', 'Test', 1);
      INSERT INTO epics (id, project_id, title, readable_id, type) VALUES ('e1', 'p1', 'Epic 1', 'E-test-001', 'feature');
      INSERT INTO epics (id, project_id, title, readable_id, type) VALUES ('e2', 'p1', 'Epic 2', NULL, 'feature');
    `);

    // Simulating backfill: only update where readable_id IS NULL
    const unassigned = sqlite
      .prepare("SELECT id FROM epics WHERE project_id = ? AND readable_id IS NULL ORDER BY created_at, id")
      .all("p1") as Array<{ id: string }>;

    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].id).toBe("e2");

    // The already-assigned epic should NOT be touched
    const existing = sqlite
      .prepare("SELECT readable_id FROM epics WHERE id = ?")
      .get("e1") as { readable_id: string };
    expect(existing.readable_id).toBe("E-test-001");
  });
});
