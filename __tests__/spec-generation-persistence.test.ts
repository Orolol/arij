import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mockJsonRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), unregister: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const { db, sqlite } = createTestDb();
  return { db, sqlite, ensureDbReady: vi.fn() };
});
vi.mock("@/lib/claude/spawn", () => ({ spawnClaude: mocks.spawn }));
vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: () => ({ provider: "claude-code", namedAgentId: null, model: undefined }),
}));
vi.mock("@/lib/agent-config/prompts", () => ({ resolveAgentPrompt: async () => "system" }));
vi.mock("@/lib/claude/prompt-builder", () => ({ buildSpecGenerationPrompt: () => "spec prompt" }));
vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));
vi.mock("@/lib/activity-registry", () => ({ activityRegistry: { register: vi.fn(), unregister: mocks.unregister } }));

import { db } from "@/lib/db";
import { documents, epics, projects, userStories } from "@/lib/db/schema";
import { listProjectTextDocuments } from "@/lib/documents/query";
import { POST } from "@/app/api/projects/[projectId]/generate-spec/route";

let counter = 0;
const generated = { spec: "# Agent proposal", epics: [{ title: "New epic", user_stories: [{ title: "New story" }] }] };
function seed() {
  const id = `spec-route-${++counter}`;
  db.insert(projects).values({ id, name: id, spec: "# Original", gitRepoPath: "/tmp/project" }).run();
  return id;
}
const post = (id: string) => POST(mockJsonRequest({}), mockRouteContext({ projectId: id }));
beforeEach(() => vi.clearAllMocks());

describe("generated spec persistence", () => {
  it("returns a conflict, keeps newer edits and all existing documents, and saves the rejected output outside default context", async () => {
    const id = seed();
    db.insert(documents).values({ id: `doc-${id}`, projectId: id, originalFilename: "spec-proposal.md", kind: "text", markdownContent: "User reference", mimeType: "text/markdown", sizeBytes: 14 }).run();
    const raw = JSON.stringify(generated);
    mocks.spawn.mockImplementation(() => {
      db.update(projects).set({ spec: "# Newer edit" }).where(eq(projects.id, id)).run();
      return { promise: Promise.resolve({ success: true, result: raw }) };
    });

    const response = await post(id);
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(payload.code).toBe("SPEC_CHANGED");
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.spec).toBe("# Newer edit");
    expect(db.select().from(epics).where(eq(epics.projectId, id)).all()).toHaveLength(0);
    expect(db.select().from(userStories).all()).toHaveLength(0);
    const proposal = db.select().from(documents).where(eq(documents.id, payload.proposalDocumentId)).get()!;
    expect(proposal.markdownContent).toBe(raw);
    expect(proposal.originalFilename).not.toBe("spec-proposal.md");
    expect(payload.error).toContain(proposal.originalFilename);
    expect(listProjectTextDocuments(id).map((document) => document.contentMd)).toEqual(["User reference"]);
    expect(mocks.unregister).toHaveBeenCalledOnce();
  });

  it("commits the spec and all tickets when the saved baseline still matches", async () => {
    const id = seed();
    mocks.spawn.mockReturnValue({ promise: Promise.resolve({ success: true, result: JSON.stringify(generated) }) });
    const response = await post(id);
    expect(response.status).toBe(200);
    expect((await response.json()).data.epicsCreated).toBe(1);
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.spec).toBe(generated.spec);
    const epic = db.select().from(epics).where(eq(epics.projectId, id)).get()!;
    expect(db.select().from(userStories).where(eq(userStories.epicId, epic.id)).get()?.title).toBe("New story");
  });

  it("does not replace the spec with an empty provider envelope", async () => {
    const id = seed();
    mocks.spawn.mockReturnValue({ promise: Promise.resolve({ success: true, result: JSON.stringify({ type: "result", subtype: "success", result: "" }) }) });
    expect((await post(id)).status).toBe(500);
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.spec).toBe("# Original");
  });
});
