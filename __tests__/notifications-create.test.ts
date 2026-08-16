import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// ---- Mocks must be hoisted above all imports ----
// Only the raw-sqlite prune helper needs a bespoke stub; the drizzle chain and
// the real @/lib/db/schema come from the shared helpers.
const mockSqliteState = vi.hoisted(() => ({
  pruneCount: { cnt: 5 },
}));

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return {
    ...dbModuleMock(),
    sqlite: {
      prepare: vi.fn(() => ({
        get: vi.fn(() => mockSqliteState.pruneCount),
      })),
      exec: vi.fn(),
    },
  };
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "notif-123"),
}));

import {
  buildTitle,
  buildTargetUrl,
  buildAskedQuestionTitle,
  buildEpicTargetUrl,
  buildStalledTitle,
  createNotificationFromSession,
  createAskedQuestionNotificationFromSession,
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
    resetDbMockState();
    mockSqliteState.pruneCount = { cnt: 5 };
  });

  it("creates notification for completed session with epic context", () => {
    dbMockState.getQueue.push(
      { id: "s1", projectId: "p1", epicId: "e1", status: "completed", agentType: "build" },
      { name: "My Project" },
      { title: "Login feature", readableId: "E-proj-003" }
    );

    createNotificationFromSession("s1");

    expect(dbMockState.insertCalls).toHaveLength(1);
    const payload = dbMockState.insertCalls[0] as Record<string, unknown>;
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
    dbMockState.getQueue.push(
      { id: "s2", projectId: "p1", epicId: null, status: "failed", agentType: "tech_check" },
      { name: "My Project" }
    );

    createNotificationFromSession("s2");

    expect(dbMockState.insertCalls).toHaveLength(1);
    const payload = dbMockState.insertCalls[0] as Record<string, unknown>;
    expect(payload.status).toBe("failed");
    expect(payload.title).toBe("Tech Check failed");
    expect(payload.targetUrl).toBe("/projects/p1/qa");
  });

  it("does nothing when session not found", () => {
    dbMockState.getQueue.push(undefined);

    createNotificationFromSession("missing");

    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("does nothing when project not found", () => {
    dbMockState.getQueue.push(
      { id: "s1", projectId: "p-gone", epicId: null, status: "completed", agentType: "build" },
      undefined
    );

    createNotificationFromSession("s1");

    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("creates notification without epic context when epicId is null", () => {
    dbMockState.getQueue.push(
      { id: "s3", projectId: "p1", epicId: null, status: "completed", agentType: "review_security" },
      { name: "Security Proj" }
    );

    createNotificationFromSession("s3");

    expect(dbMockState.insertCalls).toHaveLength(1);
    const payload = dbMockState.insertCalls[0] as Record<string, unknown>;
    expect(payload.title).toBe("Review: Security completed");
    expect(payload.projectName).toBe("Security Proj");
  });

  it("skips sessions with the asked_question verdict (owned by the question creator)", () => {
    dbMockState.getQueue.push(
      {
        id: "s4",
        projectId: "p1",
        epicId: "e1",
        status: "completed",
        agentType: "build",
        outcome: "asked_question",
      },
      { name: "My Project" },
      { title: "Login feature", readableId: "E-proj-003" }
    );

    createNotificationFromSession("s4");

    expect(dbMockState.insertCalls).toHaveLength(0);
  });
});

describe("buildAskedQuestionTitle()", () => {
  it("uses readable id and title when both exist", () => {
    expect(buildAskedQuestionTitle("Login feature", "E-proj-003")).toBe(
      "Agent asked a question on E-proj-003: Login feature"
    );
  });

  it("falls back to whichever identifier exists", () => {
    expect(buildAskedQuestionTitle("Login feature", null)).toBe(
      "Agent asked a question on Login feature"
    );
    expect(buildAskedQuestionTitle(null, "E-proj-003")).toBe(
      "Agent asked a question on E-proj-003"
    );
  });

  it("degrades to the bare copy without any ticket context", () => {
    expect(buildAskedQuestionTitle(null, null)).toBe("Agent asked a question");
  });
});

describe("buildEpicTargetUrl()", () => {
  it("deep-links to the ticket on the board", () => {
    expect(buildEpicTargetUrl("p1", "e1")).toBe("/projects/p1?ticket=e1");
  });
});

describe("buildStalledTitle()", () => {
  it("uses readable id and title when both exist", () => {
    expect(buildStalledTitle(5, "Login feature", "E-proj-003")).toBe(
      "Agent seems stalled on E-proj-003: Login feature — no output for 5m"
    );
  });

  it("falls back to whichever identifier exists", () => {
    expect(buildStalledTitle(12, "Login feature", null)).toBe(
      "Agent seems stalled on Login feature — no output for 12m"
    );
    expect(buildStalledTitle(12, null, "E-proj-003")).toBe(
      "Agent seems stalled on E-proj-003 — no output for 12m"
    );
  });

  it("degrades to the bare copy without any ticket context", () => {
    expect(buildStalledTitle(7, null, null)).toBe(
      "Agent seems stalled — no output for 7m"
    );
  });
});

describe("createAskedQuestionNotificationFromSession()", () => {
  beforeEach(() => {
    resetDbMockState();
    mockSqliteState.pruneCount = { cnt: 5 };
  });

  it("creates the question notification deep-linking to the epic", () => {
    dbMockState.getQueue.push(
      {
        id: "s5",
        projectId: "p1",
        epicId: "e1",
        status: "completed",
        agentType: "build",
        outcome: "asked_question",
      },
      { name: "My Project" },
      { title: "Login feature", readableId: "E-proj-003" }
    );

    createAskedQuestionNotificationFromSession("s5");

    expect(dbMockState.insertCalls).toHaveLength(1);
    const payload = dbMockState.insertCalls[0] as Record<string, unknown>;
    expect(payload.title).toBe(
      "Agent asked a question on E-proj-003: Login feature"
    );
    expect(payload.targetUrl).toBe("/projects/p1?ticket=e1");
    expect(payload.status).toBe("completed");
    expect(payload.agentType).toBe("build");
  });

  it("falls back to the session detail when the session has no epic", () => {
    dbMockState.getQueue.push(
      {
        id: "s6",
        projectId: "p1",
        epicId: null,
        status: "completed",
        agentType: "team_build",
        outcome: "asked_question",
      },
      { name: "My Project" }
    );

    createAskedQuestionNotificationFromSession("s6");

    expect(dbMockState.insertCalls).toHaveLength(1);
    const payload = dbMockState.insertCalls[0] as Record<string, unknown>;
    expect(payload.title).toBe("Agent asked a question");
    expect(payload.targetUrl).toBe("/projects/p1/sessions/s6");
  });

  it("does nothing when the session is gone", () => {
    dbMockState.getQueue.push(undefined);

    createAskedQuestionNotificationFromSession("missing");

    expect(dbMockState.insertCalls).toHaveLength(0);
  });
});
