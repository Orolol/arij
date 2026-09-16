import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { readEpicActivityFacts, readLatestFailureSessions } from "@/lib/control-desk/read-model";
import { selectLatestFailures } from "@/lib/agent-sessions/latest-failure";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  return { ...createTestDb(), ensureDbReady: vi.fn() };
});

const { db, sqlite } = await import("@/lib/db");
const { GET: getEpics } = await import("@/app/api/projects/[projectId]/epics/route");
const { GET: getDesk } = await import("@/app/api/control-desk/route");
const { GET: getRegistry } = await import("@/app/api/tickets/route");
const { selectBuildCandidates } = await import("@/lib/auto-mode/select");
const { autoModeRegistry } = await import("@/lib/auto-mode/registry");
const { dagBatchRegistry } = await import("@/lib/agents/dag-batch-registry");
const { pipelineRegistry } = await import("@/lib/pipeline/registry");
const { AUTO_MODE_MAX_REVIEW_REJECTIONS } = await import("@/lib/auto-mode/constants");
const { projects, epics, agentSessions, ticketComments, ticketActivityLog, userStories } = schema;

afterEach(() => {
  autoModeRegistry.resetAll();
  dagBatchRegistry.finish("queue-batch");
  pipelineRegistry.finish("queue-pipeline", "cancelled", null);
});

beforeEach(() => {
  autoModeRegistry.resetAll();
  db.delete(ticketComments).run();
  db.delete(agentSessions).run();
  db.delete(epics).run();
  db.delete(projects).run();
  db.insert(projects).values({ id: "p1", name: "Project" }).run();
  db.insert(epics).values({ id: "e1", projectId: "p1", title: "Ticket", status: "todo" }).run();
});

describe("desk queue — parent/story build policy", () => {
  async function queue() {
    return ((await (await getDesk()).json()).data.upNext[0]?.tickets ?? []) as Array<{
      epicId: string; rank: number | null; awaitingReply: boolean; noBuildableStories: boolean; hold?: string;
    }>;
  }

  it("holds a parked parent in both the desk and execution selector", async () => {
    autoModeRegistry.park("p1", "e1", "e1", "Needs human review");
    expect(await queue()).toMatchObject([{ rank: null, hold: "parked", noBuildableStories: false }]);
    expect(selectBuildCandidates("p1")).toEqual([]);
  });

  it("keeps unparked siblings eligible and explains when all work is parked", async () => {
    db.insert(userStories).values([
      { id: "s1", epicId: "e1", title: "Paused", status: "todo", position: 0 },
      { id: "s2", epicId: "e1", title: "Ready", status: "todo", position: 1 },
    ]).run();
    autoModeRegistry.park("p1", "s1", "e1", "Needs human review");
    expect(await queue()).toMatchObject([{ rank: 1, noBuildableStories: false }]);
    expect(selectBuildCandidates("p1")).toMatchObject([{ userStoryId: "s2" }]);
    autoModeRegistry.park("p1", "s2", "e1", "Needs human review");
    expect(await queue()).toMatchObject([{ rank: null, hold: "parked", awaitingReply: false, noBuildableStories: false }]);
    expect(selectBuildCandidates("p1")).toEqual([]);
  });

  it("holds the project while a DAG batch owns dispatch", async () => {
    dagBatchRegistry.start({ batchId: "queue-batch", projectId: "p1", failurePolicy: "halt", totalWaves: 1, totalEpics: 1 });
    expect(await queue()).toMatchObject([{ rank: null, hold: "owned" }]);
    expect(selectBuildCandidates("p1")).toEqual([]);
    dagBatchRegistry.finish("queue-batch");
    expect(await queue()).toMatchObject([{ rank: 1 }]);
    expect(selectBuildCandidates("p1")).toHaveLength(1);
  });

  it("reserves only the ticket owned by a pipeline", async () => {
    db.insert(epics).values({ id: "e2", projectId: "p1", title: "Ready", status: "todo", position: 1 }).run();
    pipelineRegistry.register({
      runId: "queue-pipeline", projectId: "p1", epicId: "e1", userStoryId: null,
      state: "running_build", stage: "build", stageAttempt: 1, fixCycles: 0,
      sessionIds: [], startedAt: "2026-09-10T09:00:00Z", endedAt: null, reason: null,
    });
    expect(await queue()).toMatchObject([{ epicId: "e1", rank: null, hold: "owned" }, { epicId: "e2", rank: 1 }]);
    expect(selectBuildCandidates("p1")).toMatchObject([{ epicId: "e2" }]);
  });

  it("shares the review rejection budget and its reset by a human reply", async () => {
    for (let i = 0; i < AUTO_MODE_MAX_REVIEW_REJECTIONS; i++) {
      db.insert(ticketActivityLog).values({
        id: `rejected-${i}`, projectId: "p1", epicId: "e1", fromStatus: "review", toStatus: "in_progress",
        actor: "agent", createdAt: "2026-09-10 09:00:00",
      }).run();
    }
    expect(await queue()).toMatchObject([{ rank: null, hold: "review_rejections", noBuildableStories: false }]);
    expect(selectBuildCandidates("p1")).toEqual([]);
    db.insert(ticketComments).values({ id: "reply", epicId: "e1", author: "user", content: "Please try again", createdAt: "2026-09-10T12:00:00+02:00" }).run();
    expect(await queue()).toMatchObject([{ rank: 1 }]);
    expect(selectBuildCandidates("p1")).toHaveLength(1);
  });

  it.each(["review", "done", "backlog"])("does not rank an epic whose only story is %s", async (status) => {
    db.update(epics).set({ status: "in_progress" }).run();
    db.insert(userStories).values({ id: "s1", epicId: "e1", title: "Outside the build queue", status }).run();
    db.insert(epics).values({ id: "e2", projectId: "p1", title: "Ready", status: "todo" }).run();

    expect(await queue()).toMatchObject([
      { epicId: "e1", rank: null, noBuildableStories: true },
      { epicId: "e2", rank: 1, noBuildableStories: false },
    ]);
    expect(selectBuildCandidates("p1").map((candidate) => candidate.epicId)).toEqual(["e2"]);
    const registry = (await (await getRegistry(new Request("http://localhost/api/tickets"))).json()).data.rows;
    expect(registry.find((row: { epicId: string }) => row.epicId === "e1").queueRank).toBeNull();
    expect(registry.find((row: { epicId: string }) => row.epicId === "e2").queueRank).toBe(1);
  });

  it("keeps a sibling story executable while another story awaits its answer", async () => {
    db.insert(userStories).values([
      { id: "s1", epicId: "e1", title: "Question", status: "todo", position: 0 },
      { id: "s2", epicId: "e1", title: "Independent work", status: "todo", position: 1 },
    ]).run();
    db.insert(agentSessions).values({ id: "ask", projectId: "p1", epicId: "e1", userStoryId: "s1", status: "completed", outcome: "asked_question", createdAt: "2026-09-10T09:00:00Z" }).run();

    expect(await queue()).toMatchObject([{ epicId: "e1", rank: 1, awaitingReply: false }]);
    expect(selectBuildCandidates("p1")).toMatchObject([{ epicId: "e1", userStoryId: "s2" }]);
  });

  it("holds all waiting stories, then accepts an answer on the story's own thread", async () => {
    db.insert(userStories).values({ id: "s1", epicId: "e1", title: "Question", status: "todo" }).run();
    db.insert(agentSessions).values({ id: "ask", projectId: "p1", epicId: "e1", userStoryId: "s1", status: "completed", outcome: "asked_question", createdAt: "2026-09-10T09:00:00Z" }).run();
    expect(await queue()).toMatchObject([{ rank: null, awaitingReply: true, noBuildableStories: false }]);
    expect(selectBuildCandidates("p1")).toEqual([]);

    db.insert(ticketComments).values({ id: "reply", userStoryId: "s1", author: "user", content: "Answer", createdAt: "2026-09-10T10:00:00Z" }).run();
    expect(await queue()).toMatchObject([{ rank: 1, awaitingReply: false }]);
    expect(selectBuildCandidates("p1")).toMatchObject([{ userStoryId: "s1" }]);
  });

  it("keeps a parent question blocking despite a newer answered story session", async () => {
    db.insert(userStories).values({ id: "s1", epicId: "e1", title: "Story", status: "todo" }).run();
    db.insert(agentSessions).values([
      { id: "parent-ask", projectId: "p1", epicId: "e1", status: "completed", outcome: "asked_question", createdAt: "2026-09-10T09:00:00Z" },
      { id: "story-answer", projectId: "p1", epicId: "e1", userStoryId: "s1", status: "completed", outcome: "answered", createdAt: "2026-09-10T10:00:00Z" },
    ]).run();
    expect(await queue()).toMatchObject([{ rank: null, awaitingReply: true }]);
    expect(selectBuildCandidates("p1")).toEqual([]);
  });
});

describe("ticket read models — chronological activity", () => {
  it("selects the true latest session and user reply across timestamp formats", () => {
    db.insert(agentSessions).values([
      { id: "old", projectId: "p1", epicId: "e1", outcome: "answered", createdAt: "2026-09-10T08:00:00.000Z" },
      { id: "new", projectId: "p1", epicId: "e1", outcome: "asked_question", createdAt: "2026-09-10 09:00:00", endedAt: "2026-09-10 09:05:00" },
    ]).run();
    db.insert(ticketComments).values([
      { id: "old-user", epicId: "e1", author: "user", content: "Old reply", createdAt: "2026-09-10T08:30:00Z" },
      { id: "new-user", epicId: "e1", author: "user", content: "New reply", createdAt: "2026-09-10 10:00:00" },
    ]).run();
    const facts = readEpicActivityFacts(db, ["e1"], ["p1"]);
    expect(facts.latestSessionByEpic.get("e1")).toEqual({ outcome: "asked_question", endedAt: "2026-09-10 09:05:00" });
    expect(facts.latestUserCommentByEpic.get("e1")).toBe("2026-09-10T10:00:00.000Z");
  });

  it("applies the id tie-break when timestamps describe the same instant", () => {
    db.insert(agentSessions).values([
      { id: "a", projectId: "p1", epicId: "e1", outcome: "asked_question", createdAt: "2026-09-10T11:00:00+02:00" },
      { id: "z", projectId: "p1", epicId: "e1", outcome: "answered", createdAt: "2026-09-10 09:00:00" },
    ]).run();
    expect(readEpicActivityFacts(db, ["e1"], ["p1"]).latestSessionByEpic.get("e1")?.outcome).toBe("answered");
  });

  it("clears failures using the complete newest tie group in every timestamp spelling", () => {
    db.insert(agentSessions).values([
      { id: "old", projectId: "p1", epicId: "e1", status: "failed", createdAt: "2026-09-10T08:00:00.000Z" },
      { id: "new-failed", projectId: "p1", epicId: "e1", status: "failed", createdAt: "2026-09-10T09:00:00Z" },
      { id: "new-complete", projectId: "p1", epicId: "e1", status: "completed", createdAt: "2026-09-10 09:00:00" },
    ]).run();
    const latest = readLatestFailureSessions(db, ["p1"], "2026-09-01T00:00:00.000Z");
    expect(latest.map((row) => row.id).sort()).toEqual(["new-complete", "new-failed"]);
    expect(selectLatestFailures(latest, new Set())).toEqual({});
  });

  it("keeps the project/session indexes available when normalizing aggregate timestamps", () => {
    db.insert(agentSessions).values({ id: "s1", projectId: "p1", epicId: "e1", createdAt: "2026-09-10 09:00:00" }).run();
    const plans: string[] = [];
    const inspected = drizzle(sqlite, { schema, logger: { logQuery(query, params) {
      if (!query.includes('from "agent_sessions"')) return;
      const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params) as Array<{ detail: string }>;
      plans.push(...rows.map((row) => row.detail));
    } } });
    readEpicActivityFacts(inspected, ["e1"], ["p1"]);
    readEpicActivityFacts(inspected, ["e1"], ["p1"], [{ id: "e1", projectId: "p1", status: "todo" }]);
    readLatestFailureSessions(inspected, ["p1"], "2026-09-01T00:00:00.000Z");
    expect(plans.some((line) => /SEARCH agent_sessions USING INDEX/.test(line))).toBe(true);
    expect(plans.some((line) => /agent_sessions_project_created_at_idx .*created_at>/.test(line))).toBe(true);
    expect(plans.some((line) => /^SCAN agent_sessions\b/.test(line))).toBe(false);
  });

  it("keeps a recent failure spelled with yesterday's date and a negative offset", () => {
    db.insert(agentSessions).values({
      id: "recent-offset", projectId: "p1", epicId: "e1", status: "failed",
      createdAt: "2026-08-31T23:00:00-02:00",
    }).run();
    expect(readLatestFailureSessions(db, ["p1"], "2026-09-01T00:00:00.000Z")
      .map((session) => session.id)).toEqual(["recent-offset"]);
    expect(readLatestFailureSessions(db, ["p1"], "2026-09-01T02:00:00.000Z")).toEqual([]);
  });

  it("keeps board, desk and registry consistent about the latest agent question and reply", async () => {
    db.insert(agentSessions).values([
      { id: "old", projectId: "p1", epicId: "e1", status: "completed", outcome: "answered", createdAt: "2026-09-10T08:00:00.000Z" },
      { id: "new", projectId: "p1", epicId: "e1", status: "completed", outcome: "asked_question", createdAt: "2026-09-10 09:00:00", endedAt: "2026-09-10 09:05:00" },
    ]).run();
    db.insert(ticketComments).values([
      { id: "old-comment", epicId: "e1", author: "user", content: "Old answer", createdAt: "2026-09-10T08:30:00Z" },
      { id: "new-comment", epicId: "e1", author: "agent", content: "New question", createdAt: "2026-09-10 09:05:00" },
    ]).run();
    const board = await (await getEpics(new NextRequest("http://localhost/api/projects/p1/epics"), { params: Promise.resolve({ projectId: "p1" }) })).json();
    const desk = await (await getDesk()).json();
    const registry = await (await getRegistry(new Request("http://localhost/api/tickets"))).json();
    expect(board.data[0]).not.toHaveProperty("latestCommentId");
    expect(board.data[0].latestSessionOutcome).toBe("asked_question");
    expect(desk.data.yourTurn.awaitingReply[0].question).toBe("New question");
    expect(registry.data.rows[0].yourTurnKind).toBe("asks");

    db.insert(ticketComments).values({ id: "reply", epicId: "e1", author: "user", content: "Answer", createdAt: "2026-09-10 10:00:00" }).run();
    const repliedBoard = await (await getEpics(new NextRequest("http://localhost/api/projects/p1/epics"), { params: Promise.resolve({ projectId: "p1" }) })).json();
    expect(repliedBoard.data[0]).not.toHaveProperty("latestUserCommentCreatedAt");
    expect((await (await getDesk()).json()).data.yourTurn.awaitingReply).toEqual([]);
    expect((await (await getRegistry(new Request("http://localhost/api/tickets"))).json()).data.rows[0].yourTurnKind).toBeNull();
  });
});
