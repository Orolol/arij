import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// Mock the db module to use our test database
vi.mock("@/lib/db", () => {
  const testDb = createTestDb();
  return { db: testDb.db, sqlite: testDb.sqlite };
});

// Import after mock setup
import { db } from "@/lib/db";

function seedProject() {
  db.insert(schema.projects)
    .values({ id: "p1", name: "Test Project", gitRepoPath: "/tmp/test" })
    .run();
}

function seedEpic() {
  seedProject();
  db.insert(schema.epics)
    .values({
      id: "e1",
      projectId: "p1",
      title: "Test Epic",
      status: "review",
      branchName: "feature/epic-e1-test",
    })
    .run();
}

describe("review_comments table", () => {
  beforeEach(() => {
    // Clear all data
    db.delete(schema.reviewComments).run();
    db.delete(schema.ticketComments).run();
    db.delete(schema.epics).run();
    db.delete(schema.projects).run();
  });

  it("creates the review_comments table", () => {
    seedEpic();
    const id = "rc1";
    db.insert(schema.reviewComments)
      .values({
        id,
        epicId: "e1",
        filePath: "src/app.ts",
        lineNumber: 42,
        body: "This should use a constant",
        author: "user",
        status: "open",
      })
      .run();

    const comment = db
      .select()
      .from(schema.reviewComments)
      .where(eq(schema.reviewComments.id, id))
      .get();

    expect(comment).toBeDefined();
    expect(comment!.filePath).toBe("src/app.ts");
    expect(comment!.lineNumber).toBe(42);
    expect(comment!.body).toBe("This should use a constant");
    expect(comment!.author).toBe("user");
    expect(comment!.status).toBe("open");
  });

  it("enforces foreign key to epics", () => {
    seedProject();
    expect(() => {
      db.insert(schema.reviewComments)
        .values({
          id: "rc1",
          epicId: "nonexistent",
          filePath: "file.ts",
          lineNumber: 1,
          body: "test",
        })
        .run();
    }).toThrow();
  });

  it("cascades delete when epic is deleted", () => {
    seedEpic();
    db.insert(schema.reviewComments)
      .values({
        id: "rc1",
        epicId: "e1",
        filePath: "file.ts",
        lineNumber: 1,
        body: "test comment",
      })
      .run();

    // Delete the epic
    db.delete(schema.epics).where(eq(schema.epics.id, "e1")).run();

    const comments = db.select().from(schema.reviewComments).all();
    expect(comments).toHaveLength(0);
  });

  it("filters by epic and file", () => {
    seedEpic();

    // Add comments on different files
    db.insert(schema.reviewComments)
      .values([
        { id: "rc1", epicId: "e1", filePath: "a.ts", lineNumber: 1, body: "comment 1" },
        { id: "rc2", epicId: "e1", filePath: "b.ts", lineNumber: 5, body: "comment 2" },
        { id: "rc3", epicId: "e1", filePath: "a.ts", lineNumber: 10, body: "comment 3" },
      ])
      .run();

    const aComments = db
      .select()
      .from(schema.reviewComments)
      .where(
        and(
          eq(schema.reviewComments.epicId, "e1"),
          eq(schema.reviewComments.filePath, "a.ts")
        )
      )
      .all();

    expect(aComments).toHaveLength(2);
  });

  it("supports status updates (open -> resolved)", () => {
    seedEpic();
    db.insert(schema.reviewComments)
      .values({
        id: "rc1",
        epicId: "e1",
        filePath: "file.ts",
        lineNumber: 1,
        body: "needs fix",
        status: "open",
      })
      .run();

    db.update(schema.reviewComments)
      .set({ status: "resolved", updatedAt: new Date().toISOString() })
      .where(eq(schema.reviewComments.id, "rc1"))
      .run();

    const comment = db
      .select()
      .from(schema.reviewComments)
      .where(eq(schema.reviewComments.id, "rc1"))
      .get();

    expect(comment!.status).toBe("resolved");
  });

  it("bulk resolves all open comments for an epic", () => {
    seedEpic();
    db.insert(schema.reviewComments)
      .values([
        { id: "rc1", epicId: "e1", filePath: "a.ts", lineNumber: 1, body: "fix 1", status: "open" },
        { id: "rc2", epicId: "e1", filePath: "b.ts", lineNumber: 2, body: "fix 2", status: "open" },
        { id: "rc3", epicId: "e1", filePath: "c.ts", lineNumber: 3, body: "already done", status: "resolved" },
      ])
      .run();

    db.update(schema.reviewComments)
      .set({ status: "resolved", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.reviewComments.epicId, "e1"),
          eq(schema.reviewComments.status, "open")
        )
      )
      .run();

    const open = db
      .select()
      .from(schema.reviewComments)
      .where(
        and(
          eq(schema.reviewComments.epicId, "e1"),
          eq(schema.reviewComments.status, "open")
        )
      )
      .all();

    expect(open).toHaveLength(0);

    const resolved = db
      .select()
      .from(schema.reviewComments)
      .where(eq(schema.reviewComments.epicId, "e1"))
      .all();

    expect(resolved).toHaveLength(3);
    expect(resolved.every((c) => c.status === "resolved")).toBe(true);
  });
});
