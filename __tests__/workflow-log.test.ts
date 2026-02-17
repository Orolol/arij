/**
 * Tests for workflow activity logging.
 * Verifies that logTransition correctly writes to ticketActivityLog.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { ticketActivityLog, projects, epics } from "@/lib/db/schema";
import { logTransition } from "@/lib/workflow/log";
import { eq } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";

// ---------------------------------------------------------------------------
// Setup: create a project and epic for the tests
// ---------------------------------------------------------------------------

let projectId: string;
let epicId: string;

beforeEach(() => {
  projectId = createId();
  epicId = createId();

  db.insert(projects)
    .values({
      id: projectId,
      name: "Test Project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();

  db.insert(epics)
    .values({
      id: epicId,
      projectId,
      title: "Test Epic",
      status: "backlog",
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
});

describe("logTransition", () => {
  it("inserts a record into ticketActivityLog", () => {
    logTransition({
      projectId,
      epicId,
      fromStatus: "backlog",
      toStatus: "in_progress",
      actor: "user",
    });

    const logs = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epicId))
      .all();

    expect(logs).toHaveLength(1);
    expect(logs[0].fromStatus).toBe("backlog");
    expect(logs[0].toStatus).toBe("in_progress");
    expect(logs[0].actor).toBe("user");
    expect(logs[0].reason).toBeNull();
    expect(logs[0].sessionId).toBeNull();
  });

  it("stores reason and sessionId when provided", () => {
    const sessionId = createId();
    logTransition({
      projectId,
      epicId,
      fromStatus: "in_progress",
      toStatus: "review",
      actor: "agent",
      reason: "Build completed",
      sessionId,
    });

    const logs = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epicId))
      .all();

    expect(logs).toHaveLength(1);
    expect(logs[0].actor).toBe("agent");
    expect(logs[0].reason).toBe("Build completed");
    expect(logs[0].sessionId).toBe(sessionId);
  });

  it("records multiple transitions in order", () => {
    logTransition({
      projectId,
      epicId,
      fromStatus: "backlog",
      toStatus: "todo",
      actor: "user",
      reason: "Drag-and-drop",
    });

    logTransition({
      projectId,
      epicId,
      fromStatus: "todo",
      toStatus: "in_progress",
      actor: "agent",
      reason: "Build started",
    });

    logTransition({
      projectId,
      epicId,
      fromStatus: "in_progress",
      toStatus: "review",
      actor: "agent",
      reason: "Build completed",
    });

    const logs = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epicId))
      .orderBy(ticketActivityLog.createdAt)
      .all();

    expect(logs).toHaveLength(3);
    expect(logs[0].fromStatus).toBe("backlog");
    expect(logs[0].toStatus).toBe("todo");
    expect(logs[1].fromStatus).toBe("todo");
    expect(logs[1].toStatus).toBe("in_progress");
    expect(logs[2].fromStatus).toBe("in_progress");
    expect(logs[2].toStatus).toBe("review");
  });

  it("sets createdAt timestamp", () => {
    const before = new Date().toISOString();

    logTransition({
      projectId,
      epicId,
      fromStatus: "review",
      toStatus: "done",
      actor: "user",
    });

    const after = new Date().toISOString();

    const logs = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epicId))
      .all();

    expect(logs[0].createdAt).toBeTruthy();
    expect(logs[0].createdAt! >= before).toBe(true);
    expect(logs[0].createdAt! <= after).toBe(true);
  });

  it("distinguishes user, agent, and system actors", () => {
    logTransition({
      projectId,
      epicId,
      fromStatus: "backlog",
      toStatus: "todo",
      actor: "user",
    });

    logTransition({
      projectId,
      epicId,
      fromStatus: "todo",
      toStatus: "in_progress",
      actor: "agent",
    });

    logTransition({
      projectId,
      epicId,
      fromStatus: "in_progress",
      toStatus: "review",
      actor: "system",
    });

    const logs = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epicId))
      .orderBy(ticketActivityLog.createdAt)
      .all();

    expect(logs.map((l) => l.actor)).toEqual(["user", "agent", "system"]);
  });
});
