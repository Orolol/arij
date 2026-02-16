import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import type { ArjiJson } from "@/lib/sync/arji-json";

let testDb: ReturnType<typeof createTestDb>;
let db: BetterSQLite3Database<typeof schema>;
let sqlite: Database.Database;

// Mock the db module to use our test database
vi.mock("@/lib/db", () => ({
  get db() {
    return testDb.db;
  },
}));

describe("arji.json sync roundtrip", () => {
  beforeEach(() => {
    vi.resetModules();
    testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;

    // Seed a project
    db.insert(schema.projects)
      .values({ id: "proj-1", name: "Test Project", gitRepoPath: "/tmp/test-repo" })
      .run();
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("epic type preservation", () => {
    it("exports the type field for feature epics", async () => {
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Feature Epic", type: "feature" })
        .run();

      const { exportArjiJson } = await import("@/lib/sync/export");

      // Mock writeArjiJson to capture the data
      const { writeArjiJson } = await import("@/lib/sync/arji-json");
      let capturedData: ArjiJson | null = null;
      vi.spyOn(await import("@/lib/sync/arji-json"), "writeArjiJson").mockImplementation(
        async (_path: string, data: ArjiJson) => {
          capturedData = data;
        }
      );

      await exportArjiJson("proj-1");

      expect(capturedData).not.toBeNull();
      expect(capturedData!.epics[0].type).toBe("feature");
    });

    it("exports the type field for bug epics", async () => {
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Bug Epic", type: "bug" })
        .run();

      let capturedData: ArjiJson | null = null;
      vi.spyOn(await import("@/lib/sync/arji-json"), "writeArjiJson").mockImplementation(
        async (_path: string, data: ArjiJson) => {
          capturedData = data;
        }
      );

      const { exportArjiJson } = await import("@/lib/sync/export");
      await exportArjiJson("proj-1");

      expect(capturedData!.epics[0].type).toBe("bug");
    });

    it("imports the type field for bug epics", async () => {
      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue({
        version: 1,
        lastSyncedAt: new Date().toISOString(),
        project: { name: "Test", description: null, status: "active", spec: null },
        epics: [
          {
            id: "e1",
            title: "Bug Epic",
            description: "A bug",
            priority: 2,
            status: "todo",
            position: 0,
            branchName: null,
            type: "bug",
            user_stories: [],
          },
        ],
      });

      const { importArjiJson } = await import("@/lib/sync/import");
      await importArjiJson("proj-1");

      const epic = db.select().from(schema.epics).all()[0];
      expect(epic.type).toBe("bug");
    });

    it("preserves bug type on update (existing epic)", async () => {
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Old Title", type: "bug" })
        .run();

      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue({
        version: 1,
        lastSyncedAt: new Date().toISOString(),
        project: { name: "Test", description: null, status: "active", spec: null },
        epics: [
          {
            id: "e1",
            title: "Updated Bug",
            description: null,
            priority: 1,
            status: "in_progress",
            position: 0,
            branchName: null,
            type: "bug",
            user_stories: [],
          },
        ],
      });

      const { importArjiJson } = await import("@/lib/sync/import");
      await importArjiJson("proj-1");

      const epic = db.select().from(schema.epics).all()[0];
      expect(epic.type).toBe("bug");
      expect(epic.title).toBe("Updated Bug");
    });

    it("defaults to feature when type is not specified in JSON", async () => {
      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue({
        version: 1,
        lastSyncedAt: new Date().toISOString(),
        project: { name: "Test", description: null, status: "active", spec: null },
        epics: [
          {
            id: "e1",
            title: "No Type",
            description: null,
            priority: 0,
            status: "backlog",
            position: 0,
            branchName: null,
            user_stories: [],
          },
        ],
      });

      const { importArjiJson } = await import("@/lib/sync/import");
      await importArjiJson("proj-1");

      const epic = db.select().from(schema.epics).all()[0];
      expect(epic.type).toBe("feature");
    });
  });

  describe("comments preservation", () => {
    it("exports epic comments", async () => {
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Epic 1" })
        .run();
      db.insert(schema.ticketComments)
        .values({ id: "c1", epicId: "e1", author: "user", content: "Looks good!" })
        .run();
      db.insert(schema.ticketComments)
        .values({ id: "c2", epicId: "e1", author: "agent", content: "Fixed it." })
        .run();

      let capturedData: ArjiJson | null = null;
      vi.spyOn(await import("@/lib/sync/arji-json"), "writeArjiJson").mockImplementation(
        async (_path: string, data: ArjiJson) => {
          capturedData = data;
        }
      );

      const { exportArjiJson } = await import("@/lib/sync/export");
      await exportArjiJson("proj-1");

      expect(capturedData!.epics[0].comments).toHaveLength(2);
      expect(capturedData!.epics[0].comments![0]).toMatchObject({
        id: "c1",
        author: "user",
        content: "Looks good!",
      });
      expect(capturedData!.epics[0].comments![1]).toMatchObject({
        id: "c2",
        author: "agent",
        content: "Fixed it.",
      });
    });

    it("exports user story comments", async () => {
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Epic 1" })
        .run();
      db.insert(schema.userStories)
        .values({ id: "us1", epicId: "e1", title: "Story 1" })
        .run();
      db.insert(schema.ticketComments)
        .values({ id: "c1", userStoryId: "us1", author: "user", content: "Story comment" })
        .run();

      let capturedData: ArjiJson | null = null;
      vi.spyOn(await import("@/lib/sync/arji-json"), "writeArjiJson").mockImplementation(
        async (_path: string, data: ArjiJson) => {
          capturedData = data;
        }
      );

      const { exportArjiJson } = await import("@/lib/sync/export");
      await exportArjiJson("proj-1");

      expect(capturedData!.epics[0].user_stories[0].comments).toHaveLength(1);
      expect(capturedData!.epics[0].user_stories[0].comments![0]).toMatchObject({
        id: "c1",
        author: "user",
        content: "Story comment",
      });
    });

    it("omits comments array when there are no comments", async () => {
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Epic 1" })
        .run();
      db.insert(schema.userStories)
        .values({ id: "us1", epicId: "e1", title: "Story 1" })
        .run();

      let capturedData: ArjiJson | null = null;
      vi.spyOn(await import("@/lib/sync/arji-json"), "writeArjiJson").mockImplementation(
        async (_path: string, data: ArjiJson) => {
          capturedData = data;
        }
      );

      const { exportArjiJson } = await import("@/lib/sync/export");
      await exportArjiJson("proj-1");

      expect(capturedData!.epics[0].comments).toBeUndefined();
      expect(capturedData!.epics[0].user_stories[0].comments).toBeUndefined();
    });

    it("imports epic comments (insert)", async () => {
      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue({
        version: 1,
        lastSyncedAt: new Date().toISOString(),
        project: { name: "Test", description: null, status: "active", spec: null },
        epics: [
          {
            id: "e1",
            title: "Epic 1",
            description: null,
            priority: 0,
            status: "backlog",
            position: 0,
            branchName: null,
            user_stories: [],
            comments: [
              { id: "c1", author: "user", content: "Nice!", createdAt: "2026-01-01T00:00:00Z" },
            ],
          },
        ],
      });

      const { importArjiJson } = await import("@/lib/sync/import");
      const result = await importArjiJson("proj-1");

      expect(result.commentsUpserted).toBe(1);

      const comments = db.select().from(schema.ticketComments).all();
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        id: "c1",
        epicId: "e1",
        author: "user",
        content: "Nice!",
      });
    });

    it("imports story comments (insert)", async () => {
      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue({
        version: 1,
        lastSyncedAt: new Date().toISOString(),
        project: { name: "Test", description: null, status: "active", spec: null },
        epics: [
          {
            id: "e1",
            title: "Epic 1",
            description: null,
            priority: 0,
            status: "backlog",
            position: 0,
            branchName: null,
            user_stories: [
              {
                id: "us1",
                title: "Story 1",
                description: null,
                acceptance_criteria: null,
                status: "todo",
                position: 0,
                comments: [
                  { id: "c1", author: "agent", content: "Done", createdAt: "2026-01-01T00:00:00Z" },
                ],
              },
            ],
          },
        ],
      });

      const { importArjiJson } = await import("@/lib/sync/import");
      const result = await importArjiJson("proj-1");

      expect(result.commentsUpserted).toBe(1);

      const comments = db.select().from(schema.ticketComments).all();
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        id: "c1",
        userStoryId: "us1",
        author: "agent",
        content: "Done",
      });
    });

    it("updates existing comments on import", async () => {
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Epic 1" })
        .run();
      db.insert(schema.ticketComments)
        .values({ id: "c1", epicId: "e1", author: "user", content: "Old content" })
        .run();

      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue({
        version: 1,
        lastSyncedAt: new Date().toISOString(),
        project: { name: "Test", description: null, status: "active", spec: null },
        epics: [
          {
            id: "e1",
            title: "Epic 1",
            description: null,
            priority: 0,
            status: "backlog",
            position: 0,
            branchName: null,
            user_stories: [],
            comments: [
              { id: "c1", author: "user", content: "Updated content", createdAt: "2026-01-01T00:00:00Z" },
            ],
          },
        ],
      });

      const { importArjiJson } = await import("@/lib/sync/import");
      await importArjiJson("proj-1");

      const comments = db.select().from(schema.ticketComments).all();
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toBe("Updated content");
    });

    it("handles import with no comments gracefully", async () => {
      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue({
        version: 1,
        lastSyncedAt: new Date().toISOString(),
        project: { name: "Test", description: null, status: "active", spec: null },
        epics: [
          {
            id: "e1",
            title: "Epic 1",
            description: null,
            priority: 0,
            status: "backlog",
            position: 0,
            branchName: null,
            user_stories: [],
          },
        ],
      });

      const { importArjiJson } = await import("@/lib/sync/import");
      const result = await importArjiJson("proj-1");

      expect(result.commentsUpserted).toBe(0);
      const comments = db.select().from(schema.ticketComments).all();
      expect(comments).toHaveLength(0);
    });
  });

  describe("full roundtrip", () => {
    it("roundtrips bug epics with comments through export → import", async () => {
      // Setup: a bug epic with comments on epic and story
      db.insert(schema.epics)
        .values({ id: "e1", projectId: "proj-1", title: "Bug Report", type: "bug", status: "todo" })
        .run();
      db.insert(schema.userStories)
        .values({ id: "us1", epicId: "e1", title: "Repro steps" })
        .run();
      db.insert(schema.ticketComments)
        .values({ id: "c1", epicId: "e1", author: "user", content: "Epic comment" })
        .run();
      db.insert(schema.ticketComments)
        .values({ id: "c2", userStoryId: "us1", author: "agent", content: "Story comment" })
        .run();

      // Export
      let capturedData: ArjiJson | null = null;
      vi.spyOn(await import("@/lib/sync/arji-json"), "writeArjiJson").mockImplementation(
        async (_path: string, data: ArjiJson) => {
          capturedData = data;
        }
      );

      const { exportArjiJson } = await import("@/lib/sync/export");
      await exportArjiJson("proj-1");

      // Verify export
      expect(capturedData!.epics[0].type).toBe("bug");
      expect(capturedData!.epics[0].comments).toHaveLength(1);
      expect(capturedData!.epics[0].user_stories[0].comments).toHaveLength(1);

      // Clear DB and reimport
      sqlite.exec("DELETE FROM ticket_comments");
      sqlite.exec("DELETE FROM user_stories");
      sqlite.exec("DELETE FROM epics");

      vi.spyOn(await import("@/lib/sync/arji-json"), "readArjiJson").mockResolvedValue(capturedData!);

      const { importArjiJson } = await import("@/lib/sync/import");
      const result = await importArjiJson("proj-1");

      // Verify import
      expect(result.commentsUpserted).toBe(2);

      const epics = db.select().from(schema.epics).all();
      expect(epics).toHaveLength(1);
      expect(epics[0].type).toBe("bug");

      const comments = db.select().from(schema.ticketComments).all();
      expect(comments).toHaveLength(2);

      const epicComment = comments.find((c) => c.epicId === "e1");
      expect(epicComment).toMatchObject({ id: "c1", author: "user", content: "Epic comment" });

      const storyComment = comments.find((c) => c.userStoryId === "us1");
      expect(storyComment).toMatchObject({ id: "c2", author: "agent", content: "Story comment" });
    });
  });
});
