import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockJsonRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  return { ...createTestDb(), ensureDbReady: vi.fn() };
});
vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));
vi.mock("@/lib/events/emit", () => ({ emitTicketCreated: vi.fn(), emitTicketDependenciesChanged: vi.fn() }));

const { sqlite } = await import("@/lib/db");
const { POST } = await import("@/app/api/projects/[projectId]/epics/route");
const { tryExportArjiJson } = await import("@/lib/sync/export");
const { emitTicketCreated, emitTicketDependenciesChanged } = await import("@/lib/events/emit");

const proposal = {
  sourceConversationId: "chat-a", title: "Account Security", description: "Protect accounts",
  status: "backlog", userStories: [
    { title: "Sign in", description: "", acceptanceCriteria: "- [ ] Password works" },
    { title: "Recover access", description: null, acceptanceCriteria: null },
  ],
};
function post(body: unknown = proposal, projectId = "p1") {
  return POST(mockJsonRequest(body), mockRouteContext({ projectId }));
}
function countRows(table: string) {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
function counter() {
  return (sqlite.prepare("SELECT ticket_counter FROM projects WHERE id = 'p1'").get() as { ticket_counter: number }).ticket_counter;
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite.exec("DROP TRIGGER IF EXISTS fail_proposal; DELETE FROM projects;");
  sqlite.exec(`
    INSERT INTO projects (id, name, ticket_counter) VALUES ('p1', 'One', 0), ('p2', 'Two', 0);
    INSERT INTO chat_conversations (id, project_id, type) VALUES
      ('chat-a', 'p1', 'epic_creation'), ('chat-b', 'p1', 'epic_creation'), ('chat-other-project', 'p2', 'epic_creation');
  `);
});

describe("durable chat epic creation", () => {
  it("coalesces simultaneous submissions from separate windows", async () => {
    const responses = await Promise.all([post(), post(), post()]);
    const results = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((result) => result.data.id)).size).toBe(1);
    expect(results.map((result) => result.data.userStoriesCreated)).toEqual([2, 2, 2]);
    expect(countRows("epics")).toBe(1);
    expect(countRows("user_stories")).toBe(2);
    expect(countRows("chat_epic_proposals")).toBe(1);
    expect(counter()).toBe(1);
    expect(emitTicketCreated).toHaveBeenCalledTimes(1);
    expect(tryExportArjiJson).toHaveBeenCalledTimes(1);
  });

  it("replays the normalized proposal after a lost response or a reload", async () => {
    const created = await (await post()).json();
    const retried = await post({
      userStories: [
        { acceptanceCriteria: "  - [ ] Password works  ", title: "  Sign in  ", description: null },
        { title: "Recover access" },
      ],
      title: "  Account Security  ", sourceConversationId: "chat-a", description: "Protect accounts",
      type: "feature", priority: 0,
    });
    expect(retried.status).toBe(200);
    expect((await retried.json()).data).toEqual(created.data);
    expect(counter()).toBe(1);
    expect(emitTicketCreated).toHaveBeenCalledTimes(1);
  });

  it("returns the original epic even after it has been edited", async () => {
    const created = await (await post()).json();
    sqlite.prepare("UPDATE epics SET title = 'User edit', status = 'done' WHERE id = ?").run(created.data.id);
    const retried = await (await post()).json();
    expect(retried.data).toMatchObject({ id: created.data.id, title: "User edit", status: "done", userStoriesCreated: 2 });
    expect(countRows("epics")).toBe(1);
  });

  it("keeps Backlog and Send-to-dev actions from creating two copies of the same proposal", async () => {
    const created = await (await post()).json();
    const response = await post({ ...proposal, status: "todo" });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ id: created.data.id, status: "backlog" });
    expect(countRows("epics")).toBe(1);
    expect(counter()).toBe(1);
  });

  it("keeps changed proposals, conversations and projects independent", async () => {
    const responses = await Promise.all([
      post(), post({ ...proposal, description: "A revised proposal" }),
      post({ ...proposal, sourceConversationId: "chat-b" }),
      post({ ...proposal, sourceConversationId: "chat-other-project" }, "p2"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    expect(countRows("epics")).toBe(4);
    expect(countRows("chat_epic_proposals")).toBe(4);
  });

  it.each(["missing", "chat-other-project"])("rejects a conversation outside the project (%s)", async (sourceConversationId) => {
    await post({ ...proposal, sourceConversationId: "chat-other-project" }, "p2");
    const response = await post({ ...proposal, sourceConversationId });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Conversation not found", code: "CONVERSATION_NOT_FOUND" });
    expect(countRows("epics")).toBe(1);
    expect(counter()).toBe(0);
  });

  it("does not recreate an epic deleted since its proposal was submitted", async () => {
    const created = await (await post()).json();
    sqlite.prepare("DELETE FROM epics WHERE id = ?").run(created.data.id);
    expect(sqlite.prepare("SELECT epic_id FROM chat_epic_proposals").get()).toEqual({ epic_id: null });
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("CHAT_EPIC_DELETED");
    expect(countRows("epics")).toBe(0);
    expect(counter()).toBe(1);
    expect(emitTicketCreated).toHaveBeenCalledTimes(1);
  });

  it("rolls back the proposal, stories, dependencies and number together, then allows retry", async () => {
    sqlite.exec("INSERT INTO epics (id, project_id, title) VALUES ('dependency', 'p1', 'Existing');");
    sqlite.exec("CREATE TRIGGER fail_proposal BEFORE INSERT ON chat_epic_proposals BEGIN SELECT RAISE(ABORT, 'forced ledger failure'); END;");
    const body = { ...proposal, dependencies: [{ ticketId: "$self", dependsOnTicketId: "dependency" }] };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await post(body);
    log.mockRestore();
    expect(failed.status).toBe(500);
    expect(countRows("epics")).toBe(1);
    expect(countRows("user_stories")).toBe(0);
    expect(countRows("chat_epic_proposals")).toBe(0);
    expect(countRows("ticket_dependencies")).toBe(0);
    expect(counter()).toBe(0);
    expect(emitTicketCreated).not.toHaveBeenCalled();
    expect(emitTicketDependenciesChanged).not.toHaveBeenCalled();
    expect(tryExportArjiJson).not.toHaveBeenCalled();
    sqlite.exec("DROP TRIGGER fail_proposal;");
    const succeeded = await post(body);
    expect(succeeded.status).toBe(201);
    expect((await succeeded.json()).data.dependenciesCreated).toBe(1);
    const replay = await post(body);
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.dependenciesCreated).toBe(1);
    expect(countRows("ticket_dependencies")).toBe(1);
    expect(countRows("chat_epic_proposals")).toBe(1);
    expect(counter()).toBe(1);
    expect(emitTicketDependenciesChanged).toHaveBeenCalledTimes(1);
    expect(tryExportArjiJson).toHaveBeenCalledTimes(1);
  });

  it("replays a friction conversion even though that friction is now closed", async () => {
    sqlite.exec("INSERT INTO frictions (id, project_id, agent_session_id, category, description, status) VALUES ('friction', 'p1', 'session', 'other', 'Issue', 'new');");
    const body = { ...proposal, frictionId: "friction" };
    expect((await post(body)).status).toBe(201);
    expect((await post(body)).status).toBe(200);
    expect(countRows("epics")).toBe(1);
  });

  it("preserves ordinary epic creation without a chat source", async () => {
    expect((await post({ title: "Manual" })).status).toBe(201);
    expect((await post({ title: "Manual" })).status).toBe(201);
    expect(countRows("epics")).toBe(2);
    expect(countRows("chat_epic_proposals")).toBe(0);
  });
});
