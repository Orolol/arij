import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/test-utils")).createTestDb(), ensureDbReady: vi.fn() }));
vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));
const { db } = await import("@/lib/db");
const { epics, projects, userStories, agentSessions, ticketDependencies, documents } = await import("@/lib/db/schema");
const { GET: list, POST: create } = await import("@/app/api/projects/[projectId]/epics/route");
const { GET: detail, DELETE: remove } = await import("@/app/api/projects/[projectId]/epics/[epicId]/route");
const context = { params: Promise.resolve({ projectId: "p", epicId: "e" }) };
beforeEach(() => {
  db.delete(projects).run();
  db.insert(projects).values([{ id: "p", name: "Project" }, { id: "other", name: "Other" }]).run();
  db.insert(epics).values([{ id: "e", projectId: "p", title: "Ticket", readableId: "E-project-001" }, { id: "foreign", projectId: "other", title: "Foreign" }]).run();
});
describe("audit ticket API contracts", () => {
  it("serves one scoped ticket and its stories without the board projection", async () => {
    db.insert(userStories).values({ id: "s", epicId: "e", title: "Story" }).run();
    const response = await detail(new NextRequest("http://localhost/api"), context);
    expect((await response.json()).data).toMatchObject({ epic: { id: "e" }, userStories: [{ id: "s" }], gradingReport: null });
    expect((await detail(new NextRequest("http://localhost/api"), { params: Promise.resolve({ projectId: "other", epicId: "e" }) })).status).toBe(404);
  });
  it("serves only index fields when requested", async () => {
    const response = await list(new NextRequest("http://localhost/api?view=index"), context);
    expect((await response.json()).data).toEqual([{ id: "e", readableId: "E-project-001", title: "Ticket" }]);
  });
  it("keeps the chat's latest outcome but removes unused board indicators", async () => {
    db.insert(agentSessions).values({ id: "run", projectId: "p", epicId: "e", status: "completed", outcome: "asked_question" }).run();
    const row = (await (await list(new NextRequest("http://localhost/api"), context)).json()).data[0];
    expect(row).toMatchObject({ id: "e", usCount: 0, usDone: 0, latestSessionOutcome: "asked_question" });
    for (const key of ["mergeReadiness", "gradingStatus", "latestCommentId", "sessionsCostUsd", "reviewUnverifiable"]) expect(row).not.toHaveProperty(key);
  });
  it("rejects a missing dependency atomically", async () => {
    const response = await create(new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify({ title: "New", dependencies: [{ ticketId: "$self", dependsOnTicketId: "missing" }] }) }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("DEPENDENCY_TARGET_NOT_FOUND");
    expect(db.select().from(epics).where(eq(epics.projectId, "p")).all()).toHaveLength(1);
  });
  it.each(["running", "queued"])("refuses deletion of a ticket with a %s session", async (status) => {
    db.insert(agentSessions).values({ id: "active", projectId: "p", epicId: "e", status }).run();
    expect((await remove(new NextRequest("http://localhost/api"), context)).status).toBe(409);
    expect(db.select().from(epics).where(eq(epics.id, "e")).get()).toBeDefined();
  });
  it("treats a project team session as owning its tickets", async () => {
    db.insert(agentSessions).values({ id: "team", projectId: "p", agentType: "team_build", status: "queued" }).run();
    const { getRunningSessionForTarget } = await import("@/lib/agents/concurrency");
    expect(getRunningSessionForTarget({ projectId: "p", epicId: "e", scope: "epic" })?.id).toBe("team");
    expect((await remove(new NextRequest("http://localhost/api"), context)).status).toBe(409);
  });
  it("guards deletion when only a child story identifies the active session", async () => {
    db.insert(userStories).values({ id: "s", epicId: "e", title: "Story" }).run();
    db.insert(agentSessions).values({ id: "child", projectId: "p", userStoryId: "s", status: "queued" }).run();
    expect((await remove(new NextRequest("http://localhost/api"), context)).status).toBe(409);
    const { DELETE: removeStory } = await import("@/app/api/projects/[projectId]/stories/[storyId]/route");
    expect((await removeStory(new NextRequest("http://localhost/api"), { params: Promise.resolve({ projectId: "p", storyId: "s" }) })).status).toBe(409);
  });
  it("retains a tombstone and removes both sides of dependencies", async () => {
    db.insert(epics).values({ id: "next", projectId: "p", title: "Next" }).run();
    db.insert(ticketDependencies).values({ id: "edge", projectId: "p", ticketId: "next", dependsOnTicketId: "e", scopeType: "project", scopeId: "p" }).run();
    expect((await remove(new NextRequest("http://localhost/api"), context)).status).toBe(200);
    expect(db.select().from(ticketDependencies).all()).toHaveLength(0);
    expect(db.select().from(documents).all()[0].markdownContent).toContain("Ticket");
  });
});
