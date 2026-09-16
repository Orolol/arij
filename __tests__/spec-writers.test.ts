/**
 * lib/workflow/spec-writers.ts — the helpers the two background spec writers
 * used to duplicate (#107): one sanitiser, one pending-guard, one board-state
 * loader, one commit-from-run verdict.
 *
 *   - sanitizeGeneratedSpec tolerates CRLF and info strings like `md5`,
 *     and never unwraps an inner fence pair,
 *   - the pending-guard sees queued AND running spec_generation sessions of
 *     any origin, and nothing else,
 *   - loadSpecBoardState orders epics and stories by position and releases
 *     newest-first (the two prompts used to see different orders),
 *   - commitSpecFromRun commits only an answered, non-empty run against the
 *     captured spec, and turns a concurrent edit into a failed verdict.
 */
import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const { projects, epics, userStories, releases, agentSessions, documents } = await import(
  "@/lib/db/schema"
);
const {
  SPEC_GENERATION_AGENT_TYPE,
  sanitizeGeneratedSpec,
  getPendingSpecGenerationSession,
  hasPendingSpecGeneration,
  loadSpecBoardState,
  commitSpecFromRun,
} = await import("@/lib/workflow/spec-writers");
const { ProjectSpecChangedError } = await import("@/lib/projects/spec-write");

let counter = 0;

function seedProject(spec: string | null = "# Spec") {
  counter += 1;
  const projectId = `proj-writers-${counter}`;
  db.insert(projects).values({ id: projectId, name: "P", spec }).run();
  return projectId;
}

function claudeEnvelope(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", result: text });
}

function answeredRun(sessionId: string, text: string) {
  return {
    sessionId,
    result: { success: true, result: claudeEnvelope(text), duration: 1 },
    status: "completed" as const,
    outcome: "answered" as const,
    completedAt: "2026-09-11T10:00:00.000Z",
  };
}

describe("sanitizeGeneratedSpec", () => {
  it("unwraps a full-document fence, CRLF and odd info strings included", () => {
    expect(sanitizeGeneratedSpec("```markdown\n# A\n\n- b\n```")).toBe("# A\n\n- b");
    expect(sanitizeGeneratedSpec("```md5\r\n# A\r\n\n- b\r\n```  ")).toBe("# A\r\n\n- b");
    expect(sanitizeGeneratedSpec("```md-x\n# A\n```")).toBe("# A");
    expect(sanitizeGeneratedSpec("  body  ")).toBe("body");
    expect(sanitizeGeneratedSpec("```\nbody\n```")).toBe("body");
  });

  it("leaves an inner fence pair untouched", () => {
    expect(sanitizeGeneratedSpec("a\n```ts\nx\n```\nb")).toBe("a\n```ts\nx\n```\nb");
  });

  it("leaves a spec that opens AND closes with a code block untouched", () => {
    // The lazy body anchored on `$` used to stretch from the first opening
    // fence to the last closing one and strip both.
    const spec = "```bash\nnpm i\n```\n\n# Title\n\n```js\nx\n```";
    expect(sanitizeGeneratedSpec(spec)).toBe(spec);
  });

  it("still unwraps a wrapped document that contains its own fenced block", () => {
    expect(sanitizeGeneratedSpec("```markdown\n# A\n\n```js\nx\n```\n\nB\n```")).toBe(
      "# A\n\n```js\nx\n```\n\nB"
    );
  });
});

describe("pending spec_generation guard", () => {
  it("sees queued and running sessions of any origin, ignores terminal ones", () => {
    const projectId = seedProject();
    expect(SPEC_GENERATION_AGENT_TYPE).toBe("spec_generation");
    expect(getPendingSpecGenerationSession(projectId)).toBeNull();

    db.insert(agentSessions)
      .values({
        id: `done-${counter}`,
        projectId,
        status: "completed",
        agentType: "spec_generation",
        createdAt: new Date().toISOString(),
      })
      .run();
    expect(hasPendingSpecGeneration(projectId)).toBe(false);

    db.insert(agentSessions)
      .values({
        id: `queued-${counter}`,
        projectId,
        status: "queued",
        agentType: "spec_generation",
        createdAt: new Date().toISOString(),
      })
      .run();
    expect(getPendingSpecGenerationSession(projectId)).toEqual({
      id: `queued-${counter}`,
      status: "queued",
    });
    expect(hasPendingSpecGeneration(projectId)).toBe(true);
  });
});

describe("loadSpecBoardState", () => {
  it("orders epics and stories by position and releases newest-first", () => {
    const projectId = seedProject();
    db.insert(epics)
      .values([
        { id: `e2-${counter}`, projectId, title: "Second", status: "todo", position: 1 },
        { id: `e1-${counter}`, projectId, title: "First", status: "done", position: 0 },
      ])
      .run();
    db.insert(userStories)
      .values([
        { id: `s2-${counter}`, epicId: `e1-${counter}`, title: "Story B", status: "todo", position: 1 },
        { id: `s1-${counter}`, epicId: `e1-${counter}`, title: "Story A", status: null, position: 0 },
      ])
      .run();
    db.insert(releases)
      .values([
        { id: `r1-${counter}`, projectId, version: "1.0.0", title: "Old", changelog: null, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: `r2-${counter}`, projectId, version: "1.1.0", title: "New", changelog: "- x", createdAt: "2026-02-01T00:00:00.000Z" },
      ])
      .run();

    const state = loadSpecBoardState(projectId);
    expect(state.epics.map((e) => e.title)).toEqual(["First", "Second"]);
    expect(state.userStories.map((s) => s.title)).toEqual(["Story A", "Story B"]);
    // A NULL story status reads as the schema default, never as "backlog".
    expect(state.userStories[0].status).toBe("todo");
    expect(state.releases.map((r) => r.version)).toEqual(["1.1.0", "1.0.0"]);
  });
});

describe("commitSpecFromRun", () => {
  it("commits an answered run against the captured spec", () => {
    const projectId = seedProject("# Old");
    const verdict = commitSpecFromRun({
      projectId,
      expectedSpec: "# Old",
      run: answeredRun("s1", "```md\n# New\n```"),
    });
    expect(verdict).toEqual({ success: true, error: null, output: "# New" });
    const row = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
    expect(row.spec).toBe("# New");
    expect(row.updatedAt).toBe("2026-09-11T10:00:00.000Z");
  });

  it("fails without writing when the spec changed since the prompt was built", () => {
    const projectId = seedProject("# Edited meanwhile");
    const verdict = commitSpecFromRun({
      projectId,
      expectedSpec: "# Old",
      run: answeredRun("s2", "# New"),
    });
    expect(verdict.success).toBe(false);
    expect(verdict.error).toContain(new ProjectSpecChangedError().message);
    expect(db.select().from(projects).where(eq(projects.id, projectId)).get()!.spec).toBe(
      "# Edited meanwhile"
    );
    // The rewrite is not lost: it is kept as a spec_proposal document the
    // failed session's message names.
    const proposal = db
      .select()
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .get()!;
    expect(proposal.kind).toBe("spec_proposal");
    expect(proposal.markdownContent).toBe("# New");
    expect(verdict.error).toContain(proposal.originalFilename);
  });

  it("names the reason a run left the spec unchanged", () => {
    const projectId = seedProject("# Old");
    const asked = commitSpecFromRun({
      projectId,
      expectedSpec: "# Old",
      run: { ...answeredRun("s3", "Keep the roadmap?"), outcome: "asked_question" },
    });
    expect(asked.success).toBe(false);
    expect(asked.error).toContain("asked a question");

    const silent = commitSpecFromRun({
      projectId,
      expectedSpec: "# Old",
      run: { ...answeredRun("s4", ""), outcome: "silent", result: { success: true, result: "", duration: 1 } },
    });
    expect(silent.success).toBe(false);
    expect(silent.error).toContain("left unchanged");

    const failed = commitSpecFromRun({
      projectId,
      expectedSpec: "# Old",
      run: {
        ...answeredRun("s5", ""),
        outcome: "error",
        result: { success: false, error: "CLI not found", duration: 1 },
      },
    });
    expect(failed).toEqual({ success: false, error: "CLI not found", output: "" });
    expect(db.select().from(projects).where(eq(projects.id, projectId)).get()!.spec).toBe("# Old");
  });
});
