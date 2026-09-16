/**
 * Learned project memory — API routes against the real migrated schema:
 *
 *   - GET/PUT /api/projects/[projectId]/memory: doc edit round-trip, empty
 *     state, manual-editor cap REJECTION (400, never silent truncation),
 *     envelope shapes, project 404,
 *   - PUT's optimistic guard: a save carrying a stale `expectedPrevious` is a
 *     409, never a silent overwrite of what a dream just wrote,
 *   - POST /memory/restore: puts the snapshot back AND reopens the dream
 *     window; GET /memory/restore serves the snapshot text on demand,
 *   - POST /api/projects/[projectId]/memory/distill: manual dispatch wiring
 *     (validated body -> dispatchMemoryDistillSession), source-session
 *     scoping 404, and the 409 pending-distill conflict.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockJsonRequest,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

// Keep hasPendingMemoryDistill (and the rest of the module) real — only the
// dispatch itself is stubbed; its full behavior is covered by
// memory-distill-dispatch.test.ts.
vi.mock("@/lib/workflow/memory-distill", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/workflow/memory-distill")
  >("@/lib/workflow/memory-distill");
  return { ...actual, dispatchMemoryDistillSession: dispatchMock };
});

const { db } = await import("@/lib/db");
const { projects, agentSessions } = await import("@/lib/db/schema");
const {
  PROJECT_MEMORY_MAX_CHARS,
  PROJECT_MEMORY_MAX_TOKENS,
} = await import("@/lib/documents/memory-constants");
const { saveProjectMemory } = await import("@/lib/documents/memory");
const { GET, PUT } = await import(
  "@/app/api/projects/[projectId]/memory/route"
);
const { POST: DISTILL } = await import(
  "@/app/api/projects/[projectId]/memory/distill/route"
);
const { POST: RESTORE, GET: GET_SNAPSHOT } = await import(
  "@/app/api/projects/[projectId]/memory/restore/route"
);
const { findLastDreamCutoff, recordDreamCutoff } = await import(
  "@/lib/workflow/dreaming-settings"
);
const { archiveProjectMemory } = await import("@/lib/documents/memory");

let counter = 0;

function seedProject(): string {
  counter += 1;
  const projectId = `proj-mem-route-${counter}`;
  db.insert(projects).values({ id: projectId, name: "Route Project" }).run();
  return projectId;
}

beforeEach(() => {
  vi.clearAllMocks();
  dispatchMock.mockResolvedValue({ sessionId: "distill-session-1" });
});

describe("GET /api/projects/[projectId]/memory", () => {
  it("404s for an unknown project", async () => {
    const res = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId: "missing" })
    );
    expect(res.status).toBe(404);
  });

  it("returns the empty state when no memory doc exists", async () => {
    const projectId = seedProject();
    const res = await GET(mockNextRequest(), mockRouteContext({ projectId }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Only what the panel reads: `exists` and `maxChars` had no reader.
    expect(json.data).toEqual({
      content: "",
      updatedAt: null,
      provenance: null,
      archive: null,
      pendingWriter: null,
    });
  });

  it("serves provenance, the pre-dream archive, and a pending writer", async () => {
    const projectId = seedProject();
    await PUT(
      mockJsonRequest({ content: "manual memory" }),
      mockRouteContext({ projectId })
    );
    archiveProjectMemory(projectId, "manual memory");
    db.insert(agentSessions)
      .values({ id: "dream-1", projectId, agentType: "dreaming", status: "running" })
      .run();

    const res = await GET(mockNextRequest(), mockRouteContext({ projectId }));
    const json = await res.json();

    // Story 3: who wrote the document last.
    expect(json.data.provenance).toMatchObject({ source: "manual", sessionId: null });
    // Story 5: the one pre-dream snapshot the panel can restore from — its
    // date only. The text (up to 40 KB) is served on demand by
    // GET /memory/restore, not on every refetch of the envelope.
    expect(json.data.archive).toEqual({ updatedAt: expect.any(String) });
    // Story 4: an in-flight rewrite the manual save may supersede.
    expect(json.data.pendingWriter).toEqual({
      sessionId: "dream-1",
      agentType: "dreaming",
    });
  });
});

describe("PUT /api/projects/[projectId]/memory (edit round-trip)", () => {
  it("saves and reads back the memory content", async () => {
    const projectId = seedProject();

    const putRes = await PUT(
      mockJsonRequest({ content: "## Rules\n\n- envelope responses" }),
      mockRouteContext({ projectId })
    );
    const putJson = await putRes.json();
    expect(putRes.status).toBe(200);
    expect(putJson.data.content).toBe("## Rules\n\n- envelope responses");

    const getRes = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    const getJson = await getRes.json();
    expect(getJson.data.content).toBe("## Rules\n\n- envelope responses");
    expect(getJson.data.updatedAt).toBeTruthy();
  });

  it("replaces on a second save and allows clearing with an empty string", async () => {
    const projectId = seedProject();
    await PUT(mockJsonRequest({ content: "v1" }), mockRouteContext({ projectId }));
    await PUT(mockJsonRequest({ content: "" }), mockRouteContext({ projectId }));

    const res = await GET(mockNextRequest(), mockRouteContext({ projectId }));
    const json = await res.json();
    expect(json.data.content).toBe("");
    expect(json.data.updatedAt).toBeTruthy();
  });

  it("REJECTS content over the cap with 400 (no silent truncation)", async () => {
    const projectId = seedProject();
    const res = await PUT(
      mockJsonRequest({ content: "x".repeat(PROJECT_MEMORY_MAX_CHARS + 1) }),
      mockRouteContext({ projectId })
    );
    expect(res.status).toBe(400);

    // The rejection names the cap in its unit of account: estimated tokens.
    const err = await res.json();
    expect(err.details.content[0]).toContain(
      `${PROJECT_MEMORY_MAX_TOKENS} tokens`
    );

    const getRes = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    expect((await getRes.json()).data.updatedAt).toBeNull();
  });

  it("accepts content at exactly the cap", async () => {
    const projectId = seedProject();
    const res = await PUT(
      mockJsonRequest({ content: "y".repeat(PROJECT_MEMORY_MAX_CHARS) }),
      mockRouteContext({ projectId })
    );
    expect(res.status).toBe(200);
  });

  it("400s on malformed bodies", async () => {
    const projectId = seedProject();
    for (const body of [{}, { content: 42 }, { nope: "x" }]) {
      const res = await PUT(mockJsonRequest(body), mockRouteContext({ projectId }));
      expect(res.status).toBe(400);
    }
  });

  it("404s for an unknown project", async () => {
    const res = await PUT(
      mockJsonRequest({ content: "x" }),
      mockRouteContext({ projectId: "missing" })
    );
    expect(res.status).toBe(404);
  });
});

/**
 * The panel edits a draft of the memory it LOADED. A dream can land between
 * that load and the click on Save; replacing blindly throws the dreamed text
 * away (manual writes do not archive). The editor sends what it loaded, and a
 * mismatch is a conflict the user resolves by reloading.
 */
describe("PUT /api/projects/[projectId]/memory — optimistic guard", () => {
  it("409s when the memory moved since the editor loaded it", async () => {
    const projectId = seedProject();
    saveProjectMemory(projectId, "as loaded");
    // A dream lands while the user is typing.
    saveProjectMemory(projectId, "## Dreamed\n\n- fresh rule");

    const res = await PUT(
      mockJsonRequest({ content: "my draft", expectedPrevious: "as loaded" }),
      mockRouteContext({ projectId })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("MEMORY_CHANGED");
    // The dreamed text stands.
    const getJson = await (
      await GET(mockNextRequest(), mockRouteContext({ projectId }))
    ).json();
    expect(getJson.data.content).toBe("## Dreamed\n\n- fresh rule");
  });

  it("saves when the memory is still the one the editor loaded", async () => {
    const projectId = seedProject();
    saveProjectMemory(projectId, "as loaded\n");

    const res = await PUT(
      // The editor holds the stored text verbatim, trailing newline included;
      // the guard compares like the lib does, on the trimmed document.
      mockJsonRequest({ content: "edited", expectedPrevious: "as loaded\n" }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).data.content).toBe("edited");
  });

  it("treats an empty loaded memory as 'no memory yet'", async () => {
    const projectId = seedProject();

    const res = await PUT(
      mockJsonRequest({ content: "first write", expectedPrevious: "" }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(200);
  });
});

describe("POST /api/projects/[projectId]/memory/restore", () => {
  it("404s for an unknown project", async () => {
    const res = await RESTORE(
      mockNextRequest(),
      mockRouteContext({ projectId: "missing" })
    );
    expect(res.status).toBe(404);
  });

  it("404s when no pre-dream snapshot exists yet", async () => {
    const projectId = seedProject();
    await PUT(mockJsonRequest({ content: "v1" }), mockRouteContext({ projectId }));

    const res = await RESTORE(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe("No memory snapshot to restore yet");
  });

  /**
   * The one-click restore (Story 5): the snapshot content goes back to the
   * live document, the write is recorded as manual, the snapshot stays
   * available, and the provenance record says the write was manual.
   */
  it("restores the snapshot and records a manual provenance", async () => {
    const projectId = seedProject();
    await PUT(mockJsonRequest({ content: "v1" }), mockRouteContext({ projectId }));
    archiveProjectMemory(projectId, "v1");
    await PUT(mockJsonRequest({ content: "dreamed v2" }), mockRouteContext({ projectId }));

    const res = await RESTORE(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.content).toBe("v1");
    expect(json.data.provenance).toMatchObject({ source: "manual", sessionId: null });
    // The snapshot is not consumed by a restore: restore is repeatable.
    expect(json.data.archive).toEqual({ updatedAt: expect.any(String) });
    const snapshot = await GET_SNAPSHOT(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    expect((await snapshot.json()).data.content).toBe("v1");
  });
});

describe("POST /api/projects/[projectId]/memory/restore — the dream window", () => {
  /**
   * The cutoff says "the evidence up to here is inside the stored memory".
   * Restoring the text from BEFORE the dream makes that false for every
   * session the dream digested; left in place, they would never be read again.
   */
  it("forgets the dream cutoff so the undone dream's sessions are read again", async () => {
    const projectId = seedProject();
    saveProjectMemory(projectId, "pre-dream");
    archiveProjectMemory(projectId, "pre-dream");
    saveProjectMemory(projectId, "dreamed");
    recordDreamCutoff(projectId, new Date().toISOString());
    expect(findLastDreamCutoff(projectId)).not.toBeNull();

    const res = await RESTORE(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(200);
    expect(findLastDreamCutoff(projectId)).toBeNull();
  });

  it("leaves the cutoff alone when there was nothing to restore", async () => {
    const projectId = seedProject();
    const cutoff = new Date().toISOString();
    recordDreamCutoff(projectId, cutoff);

    const res = await RESTORE(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(404);
    expect(findLastDreamCutoff(projectId)).toBe(cutoff);
  });
});

describe("GET /api/projects/[projectId]/memory/restore (snapshot preview)", () => {
  it("serves the snapshot text the restore would put back", async () => {
    const projectId = seedProject();
    archiveProjectMemory(projectId, "the pre-dream text");

    const res = await GET_SNAPSHOT(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      content: "the pre-dream text",
      updatedAt: expect.any(String),
    });
  });

  it("404s when there is no snapshot", async () => {
    const projectId = seedProject();
    const res = await GET_SNAPSHOT(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    expect(res.status).toBe(404);
  });

  it("404s for an unknown project", async () => {
    const res = await GET_SNAPSHOT(
      mockNextRequest(),
      mockRouteContext({ projectId: "missing" })
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/[projectId]/memory/distill", () => {
  it("dispatches a distill session and returns its id", async () => {
    const projectId = seedProject();
    db.insert(agentSessions)
      .values({ id: "src-1", projectId, status: "completed" })
      .run();

    const res = await DISTILL(
      mockJsonRequest({ sourceSessionId: "src-1" }),
      mockRouteContext({ projectId })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ sessionId: "distill-session-1" });
    expect(dispatchMock).toHaveBeenCalledWith({
      projectId,
      sourceSessionId: "src-1",
    });
  });

  it("dispatches without a source session (body optional)", async () => {
    const projectId = seedProject();
    const res = await DISTILL(
      mockJsonRequest({}),
      mockRouteContext({ projectId })
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledWith({
      projectId,
      sourceSessionId: null,
    });
  });

  /**
   * No client ever sent `namedAgentId` here — the distill agent is chosen in
   * Agent Config. A field nobody can set is refused, not silently honoured.
   */
  it("refuses a named-agent override — the agent comes from Agent Config", async () => {
    const projectId = seedProject();
    const res = await DISTILL(
      mockJsonRequest({ namedAgentId: "explicit-light-agent" }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(400);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  /**
   * The UI only offers "Distill learnings" on a completed, non-memory-writer
   * session — but the endpoint must not depend on the UI for that. A direct
   * POST could otherwise distill a dream (whose output IS the memory) or a run
   * that never finished.
   */
  it.each(["dreaming", "memory_distill"])(
    "400s when the source is a %s session",
    async (agentType) => {
      const projectId = seedProject();
      db.insert(agentSessions)
        .values({
          id: `src-writer-${agentType}`,
          projectId,
          status: "completed",
          agentType,
        })
        .run();

      const res = await DISTILL(
        mockJsonRequest({ sourceSessionId: `src-writer-${agentType}` }),
        mockRouteContext({ projectId })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("MEMORY_DISTILL_SOURCE_INVALID");
      expect(json.error).toContain("cannot itself be distilled");
      expect(dispatchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["queued", "running", "failed", "cancelled"])(
    "400s when the source session is %s rather than completed",
    async (status) => {
      const projectId = seedProject();
      db.insert(agentSessions)
        .values({
          id: `src-${status}`,
          projectId,
          status,
          agentType: "build",
        })
        .run();

      const res = await DISTILL(
        mockJsonRequest({ sourceSessionId: `src-${status}` }),
        mockRouteContext({ projectId })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("MEMORY_DISTILL_SOURCE_INVALID");
      expect(json.error).toContain(status);
      expect(dispatchMock).not.toHaveBeenCalled();
    }
  );

  /**
   * `asked_question` rows are `completed` too, so the status check alone lets
   * them through — and the agent is still waiting for a reply that never came.
   */
  it("400s when the source session stopped to ask a question", async () => {
    const projectId = seedProject();
    db.insert(agentSessions)
      .values({
        id: "src-asked",
        projectId,
        status: "completed",
        agentType: "build",
        outcome: "asked_question",
      })
      .run();

    const res = await DISTILL(
      mockJsonRequest({ sourceSessionId: "src-asked" }),
      mockRouteContext({ projectId })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("MEMORY_DISTILL_SOURCE_INVALID");
    expect(json.error).toContain("ask a question");
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("still accepts a completed review as a source — the manual button is offered there", async () => {
    const projectId = seedProject();
    db.insert(agentSessions)
      .values({
        id: "src-review",
        projectId,
        status: "completed",
        agentType: "review_code",
      })
      .run();

    const res = await DISTILL(
      mockJsonRequest({ sourceSessionId: "src-review" }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalled();
  });

  it("404s when the source session belongs to another project", async () => {
    const projectId = seedProject();
    const otherProjectId = seedProject();
    db.insert(agentSessions)
      .values({ id: "src-foreign", projectId: otherProjectId, status: "completed" })
      .run();

    const res = await DISTILL(
      mockJsonRequest({ sourceSessionId: "src-foreign" }),
      mockRouteContext({ projectId })
    );
    expect(res.status).toBe(404);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("409s when a distill session is already queued or running", async () => {
    const projectId = seedProject();
    db.insert(agentSessions)
      .values({
        id: "pending-distill",
        projectId,
        status: "queued",
        agentType: "memory_distill",
      })
      .run();

    const res = await DISTILL(
      mockJsonRequest({}),
      mockRouteContext({ projectId })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("MEMORY_DISTILL_PENDING");
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("404s for an unknown project", async () => {
    const res = await DISTILL(
      mockJsonRequest({}),
      mockRouteContext({ projectId: "missing" })
    );
    expect(res.status).toBe(404);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("500s with the envelope when dispatch fails", async () => {
    const projectId = seedProject();
    dispatchMock.mockRejectedValueOnce(new Error("scheduler exploded"));

    const res = await DISTILL(
      mockJsonRequest({}),
      mockRouteContext({ projectId })
    );
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("scheduler exploded");
  });
});
