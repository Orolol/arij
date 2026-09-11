import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const { db, sqlite } = createTestDb();
  return { db, sqlite, ensureDbReady: vi.fn() };
});
import { db } from "@/lib/db";
import { documents, epics, projects, userStories } from "@/lib/db/schema";
import { commitGeneratedSpec, ProjectSpecChangedError, saveConflictingSpecProposal } from "@/lib/projects/spec-write";
import { listProjectTextDocuments } from "@/lib/documents/query";
import { enrichPromptWithDocumentMentions } from "@/lib/documents/mentions";

let counter = 0;
function project() {
  const id = `spec-write-${++counter}`;
  db.insert(projects).values({ id, name: id, spec: "original" }).run();
  return id;
}
const generated = { spec: "generated", epics: [{ title: "Epic", user_stories: [{ title: "Story" }] }] };

describe("atomic spec and ticket commit", () => {
  it("refuses the whole proposal if the specification changed while the agent ran", () => {
    const id = project();
    db.update(projects).set({ spec: "human edit" }).where(eq(projects.id, id)).run();
    expect(() => commitGeneratedSpec(id, "original", generated)).toThrow(ProjectSpecChangedError);
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.spec).toBe("human edit");
    expect(db.select().from(epics).where(eq(epics.projectId, id)).all()).toHaveLength(0);
  });

  it("rolls back the spec and every preceding ticket when a story fails to insert", () => {
    const id = project();
    expect(() => commitGeneratedSpec(id, "original", {
      spec: "generated", epics: [{ title: "valid epic", user_stories: [{ title: undefined as unknown as string }] }],
    })).toThrow();
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.spec).toBe("original");
    expect(db.select().from(epics).where(eq(epics.projectId, id)).all()).toHaveLength(0);
  });

  it("commits specification, epics and stories together when the baseline still matches", () => {
    const id = project();
    expect(commitGeneratedSpec(id, "original", generated)).toBe(1);
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.spec).toBe("generated");
    const epic = db.select().from(epics).where(eq(epics.projectId, id)).get()!;
    expect(db.select().from(userStories).where(eq(userStories.epicId, epic.id)).get()?.title).toBe("Story");
  });

  it("preserves each rejected output under a unique document name, outside default prompt context", () => {
    const id = project();
    const first = saveConflictingSpecProposal(id, "first agent proposal");
    const second = saveConflictingSpecProposal(id, "second agent proposal");
    expect(first.filename).not.toBe(second.filename);
    const saved = db.select().from(documents).where(eq(documents.projectId, id)).all();
    expect(saved.map((row) => row.markdownContent).sort()).toEqual(["first agent proposal", "second agent proposal"]);
    expect(listProjectTextDocuments(id)).toEqual([]);
    const mentioned = enrichPromptWithDocumentMentions({ projectId: id, prompt: "compare", textSources: [`Review @${first.filename}`] });
    expect(mentioned.prompt).toContain("first agent proposal");
    expect(mentioned.prompt).not.toContain("second agent proposal");
  });
});
