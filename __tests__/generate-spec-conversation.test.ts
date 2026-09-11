/**
 * POST /api/projects/[projectId]/generate-spec — the chat's "Generate Spec &
 * Plan" button (#108, #12/#106 for the synchronous writer):
 *
 *   - the body `{ conversationId?, namedAgentId? }` is validated; an absent
 *     body still works (the legacy caller sent none),
 *   - when a conversationId is given, only THAT conversation's messages feed
 *     the prompt — not the project-wide mix of brainstorm/epic chats,
 *   - a conversation of another project is a 404, not an empty prompt,
 *   - the picked named agent reaches agent resolution,
 *   - the answer carries `{ spec, epicsCreated }` and the write goes through
 *     commitGeneratedSpec: a spec edited while the agent ran is a 409 whose
 *     proposal is kept as a document named in the error.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mockJsonRequest, mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

const mocks = vi.hoisted(() => ({
  providerSpawn: vi.fn(),
  resolveAgentByNamedId: vi.fn(),
  buildSpecGenerationPrompt: vi.fn(() => "spec prompt"),
}));

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(() => ({ spawn: mocks.providerSpawn })),
}));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: mocks.resolveAgentByNamedId,
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: vi.fn(async () => "system prompt"),
}));

vi.mock("@/lib/claude/prompt-builder", () => ({
  buildSpecGenerationPrompt: mocks.buildSpecGenerationPrompt,
}));

vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));

vi.mock("@/lib/activity-registry", () => ({
  activityRegistry: { register: vi.fn(), unregister: vi.fn() },
}));

const { db } = await import("@/lib/db");
const { projects, chatConversations, chatMessages, documents, epics, userStories } =
  await import("@/lib/db/schema");
const { POST } = await import("@/app/api/projects/[projectId]/generate-spec/route");

const GENERATED = {
  spec: "# Agent proposal",
  epics: [{ title: "New epic", user_stories: [{ title: "New story" }] }],
};

let counter = 0;

function seedProject(): string {
  counter += 1;
  const id = `proj-gen-spec-${counter}`;
  db.insert(projects)
    .values({ id, name: id, spec: "# Original", gitRepoPath: "/tmp/project" })
    .run();
  return id;
}

function seedConversation(projectId: string, label: string, contents: string[]): string {
  const conversationId = `conv-${label}-${counter}`;
  db.insert(chatConversations)
    .values({ id: conversationId, projectId, type: "brainstorm", label })
    .run();
  contents.forEach((content, index) => {
    db.insert(chatMessages)
      .values({
        id: `${conversationId}-m${index}`,
        projectId,
        conversationId,
        role: index % 2 === 0 ? "user" : "assistant",
        content,
        createdAt: `2026-09-11T10:00:0${index}.000Z`,
      })
      .run();
  });
  return conversationId;
}

function spawnResult(text: string) {
  mocks.providerSpawn.mockReturnValue({
    handle: "h",
    kill: vi.fn(),
    promise: Promise.resolve({ success: true, result: text, duration: 10 }),
  });
}

/** Messages handed to the prompt builder on its last call. */
function promptedMessages(): Array<{ role: string; content: string }> {
  const call = mocks.buildSpecGenerationPrompt.mock.calls.at(-1) as unknown as
    | [unknown, unknown, Array<{ role: string; content: string }>]
    | undefined;
  return call?.[2] ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAgentByNamedId.mockReturnValue({
    provider: "claude-code",
    namedAgentId: null,
    name: null,
    model: undefined,
  });
  spawnResult(JSON.stringify(GENERATED));
});

describe("POST /generate-spec — request body", () => {
  it("still generates from the whole project when no body is sent", async () => {
    const projectId = seedProject();
    seedConversation(projectId, "a", ["idea A"]);
    seedConversation(projectId, "b", ["idea B"]);

    const res = await POST(mockNextRequest({ method: "POST" }), mockRouteContext({ projectId }));

    expect(res.status).toBe(200);
    expect(promptedMessages().map((m) => m.content)).toEqual(["idea A", "idea B"]);
  });

  it("400s on a malformed body instead of silently ignoring it", async () => {
    const projectId = seedProject();
    const res = await POST(
      mockJsonRequest({ conversationId: 42 }),
      mockRouteContext({ projectId })
    );
    expect(res.status).toBe(400);
    expect(mocks.providerSpawn).not.toHaveBeenCalled();
  });
});

describe("POST /generate-spec — conversation scope", () => {
  it("feeds only the given conversation's messages to the prompt, in order", async () => {
    const projectId = seedProject();
    seedConversation(projectId, "other", ["unrelated epic chat", "sure"]);
    const conversationId = seedConversation(projectId, "brainstorm", [
      "let's build a CLI",
      "great, here is a plan",
      "add a config file",
    ]);

    const res = await POST(
      mockJsonRequest({ conversationId }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(200);
    expect(promptedMessages()).toEqual([
      { role: "user", content: "let's build a CLI" },
      { role: "assistant", content: "great, here is a plan" },
      { role: "user", content: "add a config file" },
    ]);
  });

  it("404s on a conversation that belongs to another project", async () => {
    const projectId = seedProject();
    const otherProjectId = seedProject();
    const foreign = seedConversation(otherProjectId, "foreign", ["secret"]);

    const res = await POST(
      mockJsonRequest({ conversationId: foreign }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(404);
    expect(mocks.providerSpawn).not.toHaveBeenCalled();
  });

  it("forwards the picked named agent to agent resolution", async () => {
    const projectId = seedProject();
    const conversationId = seedConversation(projectId, "c", ["hi"]);

    await POST(
      mockJsonRequest({ conversationId, namedAgentId: "agent-42" }),
      mockRouteContext({ projectId })
    );

    expect(mocks.resolveAgentByNamedId).toHaveBeenCalledWith(
      "spec_generation",
      projectId,
      "agent-42"
    );
  });
});

describe("POST /generate-spec — persistence", () => {
  it("commits the spec and every ticket, and answers { spec, epicsCreated }", async () => {
    const projectId = seedProject();
    const conversationId = seedConversation(projectId, "c", ["hi"]);

    const res = await POST(
      mockJsonRequest({ conversationId }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ spec: GENERATED.spec, epicsCreated: 1 });
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
    expect(project.spec).toBe(GENERATED.spec);
    expect(project.status).toBe("specifying");
    const epic = db.select().from(epics).where(eq(epics.projectId, projectId)).get()!;
    expect(
      db.select().from(userStories).where(eq(userStories.epicId, epic.id)).get()?.title
    ).toBe("New story");
  });

  it("409s with a saved proposal when the spec was edited while the agent ran", async () => {
    const projectId = seedProject();
    const conversationId = seedConversation(projectId, "c", ["hi"]);
    const raw = JSON.stringify(GENERATED);
    mocks.providerSpawn.mockImplementation(() => {
      db.update(projects).set({ spec: "# Newer edit" }).where(eq(projects.id, projectId)).run();
      return {
        handle: "h",
        kill: vi.fn(),
        promise: Promise.resolve({ success: true, result: raw, duration: 10 }),
      };
    });

    const res = await POST(
      mockJsonRequest({ conversationId }),
      mockRouteContext({ projectId })
    );
    const payload = await res.json();

    expect(res.status).toBe(409);
    expect(payload.code).toBe("SPEC_CHANGED");
    expect(db.select().from(projects).where(eq(projects.id, projectId)).get()?.spec).toBe(
      "# Newer edit"
    );
    expect(db.select().from(epics).where(eq(epics.projectId, projectId)).all()).toHaveLength(0);
    const proposal = db
      .select()
      .from(documents)
      .where(eq(documents.id, payload.proposalDocumentId))
      .get()!;
    expect(proposal.markdownContent).toBe(raw);
    expect(proposal.kind).toBe("spec_proposal");
    expect(payload.error).toContain(proposal.originalFilename);
  });

  it.each([
    ["an empty string", ""],
    ["null", null],
    ["whitespace", "  \n "],
  ])("keeps the stored spec when the agent returns epics with %s as spec", async (_label, emptySpec) => {
    const projectId = seedProject();
    spawnResult(JSON.stringify({ spec: emptySpec, epics: GENERATED.epics }));

    const res = await POST(mockJsonRequest({}), mockRouteContext({ projectId }));

    expect(res.status).toBe(200);
    // The epics landed, the spec did not move — and the answer does not
    // claim a spec was written.
    expect((await res.json()).data).toEqual({ spec: null, epicsCreated: 1 });
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
    expect(project.spec).toBe("# Original");
    expect(db.select().from(epics).where(eq(epics.projectId, projectId)).all()).toHaveLength(1);
  });

  it("does not replace the spec with an empty provider envelope", async () => {
    const projectId = seedProject();
    spawnResult(JSON.stringify({ type: "result", subtype: "success", result: "" }));

    const res = await POST(mockJsonRequest({}), mockRouteContext({ projectId }));

    expect(res.status).toBe(500);
    expect(db.select().from(projects).where(eq(projects.id, projectId)).get()?.spec).toBe(
      "# Original"
    );
  });
});
