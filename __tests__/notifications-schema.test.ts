import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import * as schema from "@/lib/db/schema";

describe("Schema: notifications table", () => {
  it("has all required columns", () => {
    const cols = schema.notifications;
    expect(cols.id).toBeDefined();
    expect(cols.projectId).toBeDefined();
    expect(cols.projectName).toBeDefined();
    expect(cols.sessionId).toBeDefined();
    expect(cols.agentType).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.targetUrl).toBeDefined();
    expect(cols.createdAt).toBeDefined();
  });

  it("has index on created_at", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extraConfig = (schema.notifications as any)[Symbol.for("drizzle:ExtraConfigBuilder")](
      schema.notifications
    );
    expect(extraConfig.createdAtIdx).toBeDefined();
  });

  it("exports Notification and NewNotification types", () => {
    const shape: schema.Notification = {
      id: "n1",
      projectId: "p1",
      projectName: "My Project",
      sessionId: "s1",
      agentType: "build",
      status: "completed",
      title: "Build completed",
      targetUrl: "/projects/p1/sessions/s1",
      createdAt: null,
    };
    expect(shape.status).toBe("completed");
  });
});

describe("Schema: notification_read_cursor table", () => {
  it("has id and readAt columns", () => {
    const cols = schema.notificationReadCursor;
    expect(cols.id).toBeDefined();
    expect(cols.readAt).toBeDefined();
  });

  it("exports NotificationReadCursor type", () => {
    const shape: schema.NotificationReadCursor = {
      id: 1,
      readAt: "2026-01-01T00:00:00.000Z",
    };
    expect(shape.id).toBe(1);
  });
});

describe("Notifications: table creation in test DB", () => {
  it("creates notifications table", () => {
    const { sqlite } = createTestDb();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("notifications");
    expect(tableNames).toContain("notification_read_cursor");
    sqlite.close();
  });

  it("has created_at index on notifications", () => {
    const { sqlite } = createTestDb();
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("notifications_created_at_idx");
    sqlite.close();
  });

  it("enforces FK constraint on project_id", () => {
    const { sqlite } = createTestDb();
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO notifications (id, project_id, project_name, status, title, target_url) VALUES ('n1', 'nonexistent', 'Test', 'completed', 'Title', '/url')"
        )
        .run();
    }).toThrow();
    sqlite.close();
  });

  it("allows inserting and querying notifications", () => {
    const { sqlite } = createTestDb();

    sqlite.prepare("INSERT INTO projects (id, name) VALUES ('p1', 'MyProject')").run();
    sqlite
      .prepare(
        "INSERT INTO notifications (id, project_id, project_name, session_id, agent_type, status, title, target_url) VALUES ('n1', 'p1', 'MyProject', NULL, 'build', 'completed', 'Build done', '/projects/p1')"
      )
      .run();

    const rows = sqlite.prepare("SELECT * FROM notifications").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].project_name).toBe("MyProject");
    expect(rows[0].status).toBe("completed");
    sqlite.close();
  });

  it("supports notification_read_cursor single-row design", () => {
    const { sqlite } = createTestDb();

    sqlite
      .prepare("INSERT INTO notification_read_cursor (id, read_at) VALUES (1, '2026-01-01T00:00:00.000Z')")
      .run();

    // Upsert pattern
    sqlite
      .prepare(
        "INSERT OR REPLACE INTO notification_read_cursor (id, read_at) VALUES (1, '2026-02-01T00:00:00.000Z')"
      )
      .run();

    const rows = sqlite.prepare("SELECT * FROM notification_read_cursor").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].read_at).toBe("2026-02-01T00:00:00.000Z");
    sqlite.close();
  });

  it("cascades delete when project is removed", () => {
    const { sqlite } = createTestDb();

    sqlite.prepare("INSERT INTO projects (id, name) VALUES ('p1', 'MyProject')").run();
    sqlite
      .prepare(
        "INSERT INTO notifications (id, project_id, project_name, status, title, target_url) VALUES ('n1', 'p1', 'MyProject', 'completed', 'Title', '/url')"
      )
      .run();

    sqlite.prepare("DELETE FROM projects WHERE id = 'p1'").run();

    const rows = sqlite.prepare("SELECT * FROM notifications").all();
    expect(rows).toHaveLength(0);
    sqlite.close();
  });
});
