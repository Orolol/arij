/**
 * Tests for the ticket activity audit log API.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { ticketActivityLog, projects, epics } from "@/lib/db/schema";
import { logTransition } from "@/lib/workflow/log";
import { eq, and } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";

let projectId: string;
let epic1Id: string;
let epic2Id: string;

beforeEach(() => {
  projectId = createId();
  epic1Id = createId();
  epic2Id = createId();

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
      id: epic1Id,
      projectId,
      title: "Epic 1",
      status: "backlog",
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();

  db.insert(epics)
    .values({
      id: epic2Id,
      projectId,
      title: "Epic 2",
      status: "todo",
      position: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();

  // Seed activity log
  logTransition({
    projectId,
    epicId: epic1Id,
    fromStatus: "backlog",
    toStatus: "todo",
    actor: "user",
    reason: "Drag-and-drop",
  });
  logTransition({
    projectId,
    epicId: epic1Id,
    fromStatus: "todo",
    toStatus: "in_progress",
    actor: "agent",
    reason: "Build started",
    sessionId: "session-1",
  });
  logTransition({
    projectId,
    epicId: epic2Id,
    fromStatus: "todo",
    toStatus: "in_progress",
    actor: "user",
    reason: "Manual",
  });
});

describe("Activity audit log queries", () => {
  it("returns all activity for a project", () => {
    const rows = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.projectId, projectId))
      .all();

    expect(rows).toHaveLength(3);
  });

  it("filters by epicId", () => {
    const rows = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epic1Id))
      .all();

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.epicId === epic1Id)).toBe(true);
  });

  it("filters by actor", () => {
    const agentRows = db
      .select()
      .from(ticketActivityLog)
      .where(
        and(
          eq(ticketActivityLog.projectId, projectId),
          eq(ticketActivityLog.actor, "agent")
        )
      )
      .all();

    expect(agentRows).toHaveLength(1);
    expect(agentRows[0].sessionId).toBe("session-1");
  });

  it("stores before/after state correctly", () => {
    const rows = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epic1Id))
      .all();

    const firstTransition = rows.find((r) => r.fromStatus === "backlog");
    expect(firstTransition).toBeTruthy();
    expect(firstTransition!.fromStatus).toBe("backlog");
    expect(firstTransition!.toStatus).toBe("todo");

    const secondTransition = rows.find((r) => r.fromStatus === "todo");
    expect(secondTransition).toBeTruthy();
    expect(secondTransition!.fromStatus).toBe("todo");
    expect(secondTransition!.toStatus).toBe("in_progress");
  });

  it("includes timestamps on all entries", () => {
    const rows = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.projectId, projectId))
      .all();

    for (const row of rows) {
      expect(row.createdAt).toBeTruthy();
      // Verify it's a valid ISO string
      expect(new Date(row.createdAt!).toISOString()).toBe(row.createdAt);
    }
  });

  it("records reason for transitions", () => {
    const rows = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.projectId, projectId))
      .all();

    const dragDrop = rows.find((r) => r.reason === "Drag-and-drop");
    expect(dragDrop).toBeTruthy();
    expect(dragDrop!.actor).toBe("user");
  });
});
