import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DispatchBackgroundSessionInput } from "@/lib/agent-sessions/dispatch-background-session";
const dispatch = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/test-utils")).createTestDb(), ensureDbReady: vi.fn() }));
vi.mock("@/lib/agent-sessions/dispatch-background-session", () => ({ dispatchBackgroundSession: dispatch }));
vi.mock("@/lib/agent-config/agent-resolution", () => ({ resolveAgentByNamedId: () => ({ provider: "claude-code", model: "test", name: "QA" }) }));
vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));
vi.mock("@/lib/events/emit", () => ({ emitTicketCreated: emit }));
const { db } = await import("@/lib/db");
const { projects, qaReports, epics, userStories, agentSessions } = await import("@/lib/db/schema");
const { POST } = await import("@/app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route");
const context = { params: Promise.resolve({ projectId: "p", reportId: "r" }) };
const request = () => new NextRequest("http://localhost/api", { method: "POST" });
const generated = [{ title: "Fix", description: "Finding", priority: 2, userStories: [{ title: "Story", acceptanceCriteria: "Works" }] }];
beforeEach(() => {
  vi.clearAllMocks();
  db.delete(projects).run();
  db.insert(projects).values({ id: "p", name: "Project" }).run();
  db.insert(qaReports).values({ id: "r", projectId: "p", reportContent: "Findings", status: "completed" }).run();
  dispatch.mockReturnValue({ sessionId: "generation" });
});
async function finish(result: unknown) {
  const input = dispatch.mock.calls[0][0] as DispatchBackgroundSessionInput;
  const run = { result: { success: true, result: JSON.stringify(result) } } as Parameters<NonNullable<typeof input.evaluate>>[0];
  const verdict = input.evaluate!(run);
  await input.onTerminal!({ ...run, ...verdict } as Parameters<NonNullable<typeof input.onTerminal>>[0]);
  return verdict;
}
describe("QA ticket generation", () => {
  it("returns an observable session before generating any ticket", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { sessionId: "generation" } });
    expect(db.select().from(epics).all()).toHaveLength(0);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", mode: "plan" }));
  });
  it("creates tickets, readable ids and stories atomically and emits their creation", async () => {
    await POST(request(), context);
    expect((await finish(generated)).success).toBe(true);
    const [epic] = db.select().from(epics).all();
    expect(epic).toMatchObject({ title: "Fix", type: "feature", status: "backlog" });
    expect(epic.readableId).toMatch(/^E-/);
    expect(db.select().from(userStories).all()[0]).toMatchObject({ epicId: epic.id, title: "Story" });
    expect(emit).toHaveBeenCalledWith("p", epic.id, "Fix");
  });
  it.each([[], [{ title: "Missing stories" }], { invalid: true }])("rejects unusable output without inserting anything", async (output) => {
    await POST(request(), context);
    expect((await finish(output)).success).toBe(false);
    expect(db.select().from(epics).all()).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });
  it("preserves original provider/model and resume identity", async () => {
    db.insert(agentSessions).values({ id: "original", projectId: "p", provider: "oh-my-pi", model: "original-model", cliSessionId: "resume-id" }).run();
    db.update(qaReports).set({ agentSessionId: "original" }).run();
    await POST(request(), context);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ cliSessionId: "resume-id", spawn: { resumeSession: true }, resolvedAgent: expect.objectContaining({ provider: "oh-my-pi", model: "original-model" }) }));
  });
  it("scopes the report to its project", async () => {
    db.insert(projects).values({ id: "other", name: "Other" }).run();
    expect((await POST(request(), { params: Promise.resolve({ projectId: "other", reportId: "r" }) })).status).toBe(404);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
