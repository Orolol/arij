import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const { db, sqlite } = createTestDb();
  return { db, sqlite, ensureDbReady: vi.fn() };
});
import { db } from "@/lib/db";
import { agentSessions, epics, projects, userStories, verifyReports } from "@/lib/db/schema";
import { assessEpicVerification } from "@/lib/verify/freshness";
let counter = 0;
let projectId: string;
let epicId: string;
beforeEach(() => {
  projectId = `verify-project-${++counter}`;
  epicId = `verify-epic-${counter}`;
  db.insert(projects).values({ id: projectId, name: projectId }).run();
  db.insert(epics).values({ id: epicId, projectId, title: epicId }).run();
});
function session(id: string, time: string, rest: Partial<typeof agentSessions.$inferInsert> = {}) {
  db.insert(agentSessions).values({ id: `${epicId}-${id}`, projectId, epicId, agentType: "build", status: "completed", createdAt: time, endedAt: time, ...rest }).run();
  return `${epicId}-${id}`;
}
function report(id: string, time: string, status: "pass" | "fail" = "pass", scope = { projectId, epicId }) {
  db.insert(verifyReports).values({ id: `${epicId}-${id}`, ...scope, status, startedAt: time, finishedAt: time, commands: JSON.stringify([{ name: "test", command: "npm test", exitCode: status === "pass" ? 0 : 1, durationMs: 1, tail: "" }]) }).run();
  return `${epicId}-${id}`;
}

describe("mechanical verification chronology", () => {
  it("rejects a report from earlier within the same second despite different stored formats", () => {
    session("build", "2026-09-10 10:00:00.900");
    report("pass", "2026-09-10T10:00:00.100Z");
    expect(assessEpicVerification(projectId, epicId).problem?.kind).toBe("stale");
  });

  it("accepts equivalent UTC instants with different precision and offsets", () => {
    session("build", "2026-09-10T12:00:00+02:00");
    report("pass", "2026-09-10 10:00:00.000");
    expect(assessEpicVerification(projectId, epicId).problem).toBeNull();
  });

  it("chooses the most recent code completion, including a build created earlier", () => {
    session("old", "2026-09-10T10:01:00Z");
    const latest = session("latest", "2026-09-10T12:02:00+02:00", { createdAt: "2026-09-10 09:00:00" });
    report("pass", "2026-09-10T10:01:30Z");
    expect(assessEpicVerification(projectId, epicId)).toMatchObject({ lastCodeSessionId: latest, problem: { kind: "stale" } });
  });

  it("uses completedAt when legacy sessions have no endedAt", () => {
    session("build", "2026-09-10T09:00:00Z", { endedAt: null, completedAt: "2026-09-10T10:00:00Z" });
    report("pass", "2026-09-10T09:30:00Z");
    expect(assessEpicVerification(projectId, epicId).problem?.kind).toBe("stale");
  });

  it("chooses a newer failed report over a lexically later older pass", () => {
    session("build", "2026-09-10 09:00:00");
    report("older", "2026-09-10T12:00:00+02:00");
    const newer = report("newer", "2026-09-10 10:01:00", "fail");
    expect(assessEpicVerification(projectId, epicId)).toMatchObject({ report: { id: newer }, problem: { kind: "failed" } });
  });

  it.each(["ticket_build", "team_build", "fix", "merge"])("invalidates earlier evidence after %s changes the epic branch", (agentType) => {
    const userStoryId = `${epicId}-story`;
    db.insert(userStories).values({ id: userStoryId, epicId, title: "Story" }).run();
    session("code", "2026-09-10 10:00:00", { agentType, userStoryId });
    report("pass", "2026-09-10T09:59:59Z");
    expect(assessEpicVerification(projectId, epicId).problem?.kind).toBe("stale");
  });

  it("cannot use an invalid report timestamp as passing evidence", () => {
    session("build", "2026-09-10 10:00:00");
    report("pass", "not-a-date");
    expect(assessEpicVerification(projectId, epicId).problem?.kind).toBe("stale");
  });

  it("cannot hide an undated code change behind another dated session", () => {
    session("dated", "2026-09-10 10:00:00");
    session("undated", "not-a-date");
    report("pass", "2026-09-10T11:00:00Z");
    expect(assessEpicVerification(projectId, epicId).problem?.kind).toBe("stale");
  });

  it("isolates evidence and changes to the requested epic and project", () => {
    report("pass", "2026-09-10 10:00:00");
    const otherEpic = `${epicId}-other`;
    db.insert(epics).values({ id: otherEpic, projectId, title: otherEpic }).run();
    session("elsewhere", "2026-09-10 11:00:00", { epicId: otherEpic });
    report("elsewhere", "2026-09-10 11:00:00", "fail", { projectId, epicId: otherEpic });
    expect(assessEpicVerification(projectId, epicId).problem).toBeNull();
  });
});
