import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks must be hoisted above all imports ----
const mockDbState = vi.hoisted(() => ({
  insertCalls: [] as Array<{ payload: unknown }>,
  getQueue: [] as Array<unknown>,
  pruneCount: { cnt: 5 },
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDbState.getQueue.shift()),
    insert: vi.fn(() => ({
      values: vi.fn((payload: unknown) => {
        mockDbState.insertCalls.push({ payload });
        return { run: vi.fn() };
      }),
    })),
  };

  return {
    db: chain,
    sqlite: {
      prepare: vi.fn(() => ({
        get: vi.fn(() => mockDbState.pruneCount),
      })),
      exec: vi.fn(),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  agentSessions: { id: "id", projectId: "project_id", epicId: "epic_id", status: "status", agentType: "agent_type" },
  projects: { name: "name", id: "id" },
  epics: { id: "id", title: "title", readableId: "readable_id" },
  notifications: { __name: "notifications" },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "notif-123"),
}));

import {
  buildTitle,
  buildTargetUrl,
  createNotificationFromSession,
} from "@/lib/notifications/create";

// ---- Tests ----

describe("buildTitle()", () => {
  it("formats completed build with epic context", () => {
    expect(buildTitle("build", "completed", "Login feature", "E-proj-003")).toBe(
      "Build completed \u2014 E-proj-003: Login feature"
    );
  });

  it("formats failed tech check without epic", () => {
    expect(buildTitle("tech_check", "failed")).toBe("Tech Check failed");
  });

  it("formats completed review with epic title but no readable ID", () => {
    expect(buildTitle("review_code", "completed", "Signup flow", null)).toBe(
      "Review: Code completed \u2014 Signup flow"
    );
  });

  it("uses agent type string when label not found", () => {
    expect(buildTitle("unknown_type", "completed")).toBe("unknown_type completed");
  });

  it("uses 'Agent' when agentType is null", () => {
    expect(buildTitle(null, "failed")).toBe("Agent failed");
  });

  it("formats team build", () => {
    expect(buildTitle("team_build", "completed", "Auth system", "E-auth-001")).toBe(
      "Team Build completed \u2014 E-auth-001: Auth system"
    );
  });
});

describe("buildTargetUrl()", () => {
  it("routes tech_check to QA tab", () => {
    expect(buildTargetUrl("p1", "s1", "tech_check")).toBe("/projects/p1/qa");
  });

  it("routes e2e_test to QA tab", () => {
    expect(buildTargetUrl("p1", "s1", "e2e_test")).toBe("/projects/p1/qa");
  });

  it("routes build to session detail", () => {
    expect(buildTargetUrl("p1", "s1", "build")).toBe("/projects/p1/sessions/s1");
  });

  it("routes review_code to session detail", () => {
    expect(buildTargetUrl("p1", "s1", "review_code")).toBe("/projects/p1/sessions/s1");
  });

  it("routes null agentType to session detail", () => {
    expect(buildTargetUrl("p1", "s1", null)).toBe("/projects/p1/sessions/s1");
  });
});

describe("createNotificationFromSession()", () => {
  beforeEach(() => {
    mockDbState.insertCalls.length = 0;
    mockDbState.getQueue.length = 0;
    mockDbState.pruneCount = { cnt: 5 };
  });

  it("creates notification for completed session with epic context", () => {
    mockDbState.getQueue.push(
      { id: "s1", projectId: "p1", epicId: "e1", status: "completed", agentType: "build" },
      { name: "My Project" },
      { title: "Login feature", readableId: "E-proj-003" }
    );

    createNotificationFromSession("s1");

    expect(mockDbState.insertCalls).toHaveLength(1);
    const payload = mockDbState.insertCalls[0].payload as Record<string, unknown>;
    expect(payload.id).toBe("notif-123");
    expect(payload.projectId).toBe("p1");
    expect(payload.projectName).toBe("My Project");
    expect(payload.sessionId).toBe("s1");
    expect(payload.agentType).toBe("build");
    expect(payload.status).toBe("completed");
    expect(payload.title).toBe("Build completed \u2014 E-proj-003: Login feature");
    expect(payload.targetUrl).toBe("/projects/p1/sessions/s1");
  });

  it("creates notification for failed session with QA target", () => {
    mockDbState.getQueue.push(
      { id: "s2", projectId: "p1", epicId: null, status: "failed", agentType: "tech_check" },
      { name: "My Project" }
    );

    createNotificationFromSession("s2");

    expect(mockDbState.insertCalls).toHaveLength(1);
    const payload = mockDbState.insertCalls[0].payload as Record<string, unknown>;
    expect(payload.status).toBe("failed");
    expect(payload.title).toBe("Tech Check failed");
    expect(payload.targetUrl).toBe("/projects/p1/qa");
  });

  it("does nothing when session not found", () => {
    mockDbState.getQueue.push(undefined);

    createNotificationFromSession("missing");

    expect(mockDbState.insertCalls).toHaveLength(0);
  });

  it("does nothing when project not found", () => {
    mockDbState.getQueue.push(
      { id: "s1", projectId: "p-gone", epicId: null, status: "completed", agentType: "build" },
      undefined
    );

    createNotificationFromSession("s1");

    expect(mockDbState.insertCalls).toHaveLength(0);
  });

  it("creates notification without epic context when epicId is null", () => {
    mockDbState.getQueue.push(
      { id: "s3", projectId: "p1", epicId: null, status: "completed", agentType: "review_security" },
      { name: "Security Proj" }
    );

    createNotificationFromSession("s3");

    expect(mockDbState.insertCalls).toHaveLength(1);
    const payload = mockDbState.insertCalls[0].payload as Record<string, unknown>;
    expect(payload.title).toBe("Review: Security completed");
    expect(payload.projectName).toBe("Security Proj");
  });
});
