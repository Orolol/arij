/**
 * The Arij tool calls a session made, indexed as they are WRITTEN (#236).
 *
 * The chunk-derived half of the Arij-actions list used to be rebuilt by
 * scanning the whole raw stream, in 2 MiB pages, every time a finished
 * session was opened in a new process — ~56 sequential requests for the
 * 112 MB session on the live database, to recover a handful of calls. The
 * scanner was already incremental, so it now runs where each raw chunk is
 * appended (process-manager's onChunk) and persists what it finds; reading
 * the list of an indexed session is one indexed query, whatever the stream
 * weighs, and survives the raw stream being trimmed or pruned.
 *
 * Sessions written before the index keep the bounded scan.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

/** What the fake provider was handed, so the test can play the child. */
const spawned = vi.hoisted(() => ({
  onChunk: null as
    | null
    | ((chunk: {
        streamType: "raw" | "output" | "response";
        text: string;
        chunkKey?: string;
        emittedAt: string;
      }) => void),
  settle: null as null | ((result: { success: boolean; duration: number }) => void),
}));

vi.mock("@/lib/providers", () => ({
  getProvider: () => ({
    spawn: (options: { onChunk?: typeof spawned.onChunk }) => {
      spawned.onChunk = options.onChunk ?? null;
      const promise = new Promise((resolve) => {
        spawned.settle = resolve;
      });
      return { handle: "fake", kill: vi.fn(), promise };
    },
  }),
}));

vi.mock("@/lib/agents/scheduler", () => ({
  agentScheduler: { remove: vi.fn() },
}));
vi.mock("@/lib/activity-registry", () => ({
  activityRegistry: { cancelInProject: vi.fn(() => false) },
}));

const { db } = await import("@/lib/db");
const {
  projects,
  epics,
  agentSessions,
  agentSessionToolCalls,
  agentSessionToolCallIndex,
  agentSessionChunks,
} = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");
const chunks = await import("@/lib/agent-sessions/chunks");
const { appendSessionChunk } = chunks;
const scan = await import("@/lib/agent-sessions/arij-action-scan");
const { resetArijToolCallScans, startArijToolCallIndex, readIndexedArijToolCalls } =
  scan;
const { createArijToolCallScanner } = await import(
  "@/lib/agent-sessions/arij-actions"
);
const { processManager } = await import("@/lib/claude/process-manager");
const { GET } = await import(
  "@/app/api/projects/[projectId]/sessions/[sessionId]/route"
);

const PROJECT = "proj-idx";
let sessionSeq = 0;
let SESSION = "";

function toolUseLine(id: string, tool: string): string {
  return `${JSON.stringify({
    type: "tool_use",
    id,
    name: `mcp__arij__${tool}`,
    input: {},
  })}\n`;
}

function ompWriteLine(id: string, tool: string): string {
  return `${JSON.stringify({
    type: "toolCall",
    id,
    name: "write",
    arguments: { path: `xd://mcp__arij_${tool}`, content: "{}" },
  })}\n`;
}

function insertSession(id: string): void {
  db.insert(agentSessions)
    .values({
      id,
      projectId: PROJECT,
      epicId: "epic-idx",
      status: "running",
      mode: "code",
      // An MCP-exempt type keeps the spawn free of the token channel, which
      // is not what this suite is about.
      agentType: "memory_distill",
      provider: "codex",
    })
    .run();
}

function rows(sessionId: string) {
  return db
    .select()
    .from(agentSessionToolCalls)
    .all()
    .filter((row) => row.sessionId === sessionId)
    .sort((a, b) => a.sequence - b.sequence);
}

function markerFor(sessionId: string) {
  return db
    .select()
    .from(agentSessionToolCallIndex)
    .all()
    .find((row) => row.sessionId === sessionId);
}

function emitRaw(text: string, emittedAt = "2026-09-11T10:00:00.000Z"): void {
  if (!spawned.onChunk) throw new Error("nothing spawned");
  spawned.onChunk({ streamType: "raw", text, emittedAt });
}

async function finishRun(): Promise<void> {
  spawned.settle?.({ success: true, duration: 1 });
  // then → finally → the flush of the indexer.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetArijToolCallScans();
  spawned.onChunk = null;
  spawned.settle = null;
  sessionSeq += 1;
  SESSION = `sess-idx-${sessionSeq}`;
  if (!db.select().from(projects).all().some((p) => p.id === PROJECT)) {
    db.insert(projects).values({ id: PROJECT, name: "Idx" }).run();
    db.insert(epics).values({ id: "epic-idx", projectId: PROJECT, title: "E" }).run();
  }
  insertSession(SESSION);
});

describe("indexing in the write path (process-manager onChunk)", () => {
  it("persists every Arij call as the raw chunks arrive, a call split across chunks included", async () => {
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");

    const split = toolUseLine("tu_2", "submit_findings");
    const half = Math.floor(split.length / 2);
    emitRaw(`${"noise ".repeat(100)}\n`);
    emitRaw(toolUseLine("tu_1", "get_ticket"), "2026-09-11T10:00:01.000Z");
    expect(rows(SESSION).map((r) => r.tool)).toEqual(["get_ticket"]);

    emitRaw(split.slice(0, half), "2026-09-11T10:00:02.000Z");
    // Half a line is not a call yet — it is never persisted tentatively.
    expect(rows(SESSION)).toHaveLength(1);
    emitRaw(split.slice(half), "2026-09-11T10:00:03.000Z");
    emitRaw(ompWriteLine("omp_1", "post_comment"), "2026-09-11T10:00:04.000Z");

    // Other streams are final results, not the running log: not scanned.
    spawned.onChunk?.({
      streamType: "output",
      text: toolUseLine("tu_out", "get_ticket"),
      emittedAt: "2026-09-11T10:00:05.000Z",
    });

    await finishRun();

    const persisted = rows(SESSION);
    expect(persisted.map((r) => r.tool)).toEqual([
      "get_ticket",
      "submit_findings",
      "post_comment",
    ]);
    expect(persisted.map((r) => r.sequence)).toEqual([0, 1, 2]);
    expect(persisted.map((r) => r.at)).toEqual([
      "2026-09-11T10:00:01.000Z",
      "2026-09-11T10:00:03.000Z",
      "2026-09-11T10:00:04.000Z",
    ]);
    expect(markerFor(SESSION)).toBeDefined();
  });

  it("flushes a final call the stream never terminated with a newline", async () => {
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_1", "get_ticket").trimEnd());
    expect(rows(SESSION)).toHaveLength(0);

    await finishRun();

    expect(rows(SESSION).map((r) => r.tool)).toEqual(["get_ticket"]);
  });

  it("does not claim a session whose earlier raw output was never indexed", async () => {
    // A resumed pre-index session: its first run's calls are only in the raw
    // stream, so marking it indexed now would hide them. It keeps the scan.
    appendSessionChunk({
      sessionId: SESSION,
      streamType: "raw",
      content: toolUseLine("tu_old", "get_ticket"),
    });

    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_new", "get_ticket"));
    await finishRun();

    expect(markerFor(SESSION)).toBeUndefined();
    expect(rows(SESSION)).toHaveLength(0);
    expect(readIndexedArijToolCalls(SESSION)).toBeNull();
  });

  it("continues the sequence when an indexed session is resumed", async () => {
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_1", "get_ticket"));
    await finishRun();

    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_2", "update_ticket_status"));
    await finishRun();

    expect(rows(SESSION).map((r) => [r.sequence, r.tool])).toEqual([
      [0, "get_ticket"],
      [1, "update_ticket_status"],
    ]);
  });

  it("does not record a call twice when a resumed run re-emits an earlier run's call id", async () => {
    // Each spawn gets a fresh scanner, so its in-memory id dedupe cannot see
    // the previous run; the stored call id is what catches a provider that
    // replays history (omp's session header, a message echo) on resume.
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_1", "get_ticket"));
    emitRaw(ompWriteLine("omp_1", "post_comment"));
    await finishRun();

    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_1", "get_ticket"));
    emitRaw(ompWriteLine("omp_1", "post_comment"));
    emitRaw(toolUseLine("tu_2", "update_ticket_status"));
    await finishRun();

    expect(readIndexedArijToolCalls(SESSION)?.map((c) => c.tool)).toEqual([
      "get_ticket",
      "post_comment",
      "update_ticket_status",
    ]);
  });

  it("gives the session back to the scan when a write fails, instead of serving a short list", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const indexer = startArijToolCallIndex(SESSION);
    expect(indexer).not.toBeNull();
    indexer!.push(toolUseLine("tu_1", "get_ticket"), null);
    expect(readIndexedArijToolCalls(SESSION)).toHaveLength(1);

    // The session row vanishes mid-run: the next insert breaks its FK.
    const insert = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("disk I/O error");
    });
    indexer!.push(toolUseLine("tu_2", "get_ticket"), null);
    insert.mockRestore();

    expect(readIndexedArijToolCalls(SESSION)).toBeNull();
    // …and it stays given back: later pushes do not re-open a partial index.
    indexer!.push(toolUseLine("tu_3", "get_ticket"), null);
    indexer!.finish();
    expect(readIndexedArijToolCalls(SESSION)).toBeNull();
  });
});

describe("reading an indexed session (?view=arij-actions)", () => {
  function get(sessionId: string) {
    return GET(
      mockNextRequest({ searchParams: { view: "arij-actions" } }),
      mockRouteContext({ projectId: PROJECT, sessionId })
    );
  }

  it("answers from the index in one request, without touching the raw stream", async () => {
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    // A stream far over the scan's page budget, with the calls at both ends.
    emitRaw(toolUseLine("tu_1", "get_ticket"), "2026-09-11T10:00:01.000Z");
    for (let i = 0; i < 12; i++) emitRaw(`${"x".repeat(200 * 1024)}\n`);
    emitRaw(toolUseLine("tu_2", "get_ticket"), "2026-09-11T10:00:09.000Z");
    await finishRun();

    const page = vi.spyOn(chunks, "listSessionChunkPage");
    const whole = vi.spyOn(chunks, "listSessionChunks");
    const json = await (await get(SESSION)).json();

    expect(json.data.hasMore).toBe(false);
    expect(json.data.actions.map((a: { summary: string }) => a.summary)).toEqual([
      "Read ticket state (get_ticket)",
      "Read ticket state (get_ticket)",
    ]);
    expect(page).not.toHaveBeenCalled();
    expect(whole).not.toHaveBeenCalled();
  });

  it("keeps a call whose raw chunk was trimmed or pruned since", async () => {
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_1", "ask_question"));
    await finishRun();

    // The middle of the raw stream is disposable once it has been indexed.
    db.delete(agentSessionChunks).run();

    const json = await (await get(SESSION)).json();
    expect(json.data.actions.map((a: { summary: string }) => a.summary)).toEqual([
      "Called ask_question (no recorded effect)",
    ]);
  });

  it("still scans a session written before the index", async () => {
    appendSessionChunk({
      sessionId: SESSION,
      streamType: "raw",
      content: toolUseLine("tu_1", "get_ticket"),
    });

    const page = vi.spyOn(chunks, "listSessionChunkPage");
    const json = await (await get(SESSION)).json();

    expect(json.data.actions).toHaveLength(1);
    expect(page).toHaveBeenCalled();
  });

  it("persists the scan of a finished pre-index session, so the next open reads the index", async () => {
    // The sessions that motivated #236 all predate the index: without this,
    // every process (and every LRU eviction) replays their whole raw stream.
    db.update(agentSessions)
      .set({ status: "completed" })
      .where(eq(agentSessions.id, SESSION))
      .run();
    appendSessionChunk({
      sessionId: SESSION,
      streamType: "raw",
      content: toolUseLine("tu_1", "get_ticket"),
      createdAt: "2026-09-11T10:00:01.000Z",
    });
    for (let i = 0; i < 12; i++) {
      appendSessionChunk({
        sessionId: SESSION,
        streamType: "raw",
        content: `${"x".repeat(200 * 1024)}\n`,
      });
    }
    // Unterminated: the end of the stream is what completes this line.
    appendSessionChunk({
      sessionId: SESSION,
      streamType: "raw",
      content: toolUseLine("tu_2", "ask_question").trimEnd(),
      createdAt: "2026-09-11T10:00:09.000Z",
    });

    let json = await (await get(SESSION)).json();
    for (let i = 0; i < 10 && json.data.hasMore; i++) {
      json = await (await get(SESSION)).json();
    }
    expect(json.data.hasMore).toBe(false);

    expect(markerFor(SESSION)).toBeDefined();
    expect(rows(SESSION).map((r) => [r.sequence, r.tool, r.at])).toEqual([
      [0, "get_ticket", "2026-09-11T10:00:01.000Z"],
      [1, "ask_question", "2026-09-11T10:00:09.000Z"],
    ]);

    // A new process: no cached scan, and no page of the raw stream read.
    resetArijToolCallScans();
    const page = vi.spyOn(chunks, "listSessionChunkPage");
    const again = await (await get(SESSION)).json();
    expect(page).not.toHaveBeenCalled();
    expect(again.data.hasMore).toBe(false);
    expect(again.data.actions.map((a: { summary: string }) => a.summary)).toEqual([
      "Read ticket state (get_ticket)",
      "Called ask_question (no recorded effect)",
    ]);

    // …and a later resume continues the persisted sequence.
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_3", "get_ticket"));
    await finishRun();
    expect(rows(SESSION).map((r) => r.sequence)).toEqual([0, 1, 2]);
  });

  it("does not persist the scan of a session that is still going", async () => {
    // status "running": more raw output may come, and nothing is indexing it.
    appendSessionChunk({
      sessionId: SESSION,
      streamType: "raw",
      content: toolUseLine("tu_1", "get_ticket"),
    });

    const json = await (await get(SESSION)).json();
    expect(json.data.hasMore).toBe(false);
    expect(markerFor(SESSION)).toBeUndefined();
  });

  it("does not persist the scan while a run the index declined is live, even if the row says terminal", async () => {
    // A resume of a pre-index session: the dispatcher may flip the row to
    // running after the spawn, and the scan must not claim the session in
    // between — that run's calls would be missing from a "complete" index.
    appendSessionChunk({
      sessionId: SESSION,
      streamType: "raw",
      content: toolUseLine("tu_1", "get_ticket"),
    });
    db.update(agentSessions)
      .set({ status: "completed" })
      .where(eq(agentSessions.id, SESSION))
      .run();

    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_2", "get_ticket"));
    await get(SESSION);
    expect(markerFor(SESSION)).toBeUndefined();

    await finishRun();
    resetArijToolCallScans();
    const json = await (await get(SESSION)).json();
    expect(json.data.hasMore).toBe(false);
    expect(rows(SESSION).map((r) => r.tool)).toEqual(["get_ticket", "get_ticket"]);
    expect(markerFor(SESSION)).toBeDefined();
  });

  it("drops the index with its session", async () => {
    processManager.start(SESSION, { mode: "code", prompt: "p" }, "codex");
    emitRaw(toolUseLine("tu_1", "get_ticket"));
    await finishRun();

    // createTestDb() runs with foreign_keys ON, like the app connection.
    db.delete(agentSessions).where(eq(agentSessions.id, SESSION)).run();
    expect(rows(SESSION)).toHaveLength(0);
    expect(markerFor(SESSION)).toBeUndefined();
  });
});

describe("the scanner, as the write path uses it", () => {
  it("separates committed calls from the tentative tail, and flushes the tail at the end", () => {
    const scanner = createArijToolCallScanner();
    scanner.push(toolUseLine("tu_1", "get_ticket"), "t1");
    scanner.push(toolUseLine("tu_2", "post_comment").trimEnd(), "t2");

    expect(scanner.snapshot()).toHaveLength(2);
    expect(scanner.committed().map((c) => c.tool)).toEqual(["get_ticket"]);
    expect(scanner.committed(1)).toEqual([]);

    scanner.flush();
    expect(scanner.committed(1)).toEqual([
      { tool: "post_comment", at: "t2", callId: "tu_2" },
    ]);
    expect(scanner.pending()).toBe(0);
  });

  it("counts a codex item.started / item.updated / item.completed triple once", () => {
    const item = (status: string) => ({
      id: "item_3",
      type: "mcp_tool_call",
      server: "arij",
      tool: "post_comment",
      arguments: {},
      status,
    });
    const scanner = createArijToolCallScanner();
    scanner.push(
      `${JSON.stringify({ type: "item.started", item: item("in_progress") })}\n` +
        `${JSON.stringify({ type: "item.updated", item: item("in_progress") })}\n` +
        `${JSON.stringify({ type: "item.completed", item: item("completed") })}\n`,
      "t1"
    );
    expect(scanner.committed().map((c) => c.tool)).toEqual(["post_comment"]);
    // codex numbers items per exec, so its ids are not stored for dedupe.
    expect(scanner.committed()[0].callId).toBeNull();

    // A resumed exec numbers from item_0 again: a finished id is reusable.
    scanner.push(
      `${JSON.stringify({ type: "item.started", item: item("in_progress") })}\n` +
        `${JSON.stringify({ type: "item.completed", item: item("completed") })}\n`,
      "t2"
    );
    expect(scanner.committed().map((c) => c.at)).toEqual(["t1", "t2"]);
  });

  it("does not parse tool output that merely quotes an Arij call", () => {
    // In the Arij repository, a Read or grep of its own MCP routes returns
    // text full of `mcp__arij_` — escaped inside a JSON string, never a key.
    const parse = vi.spyOn(JSON, "parse");
    const scanner = createArijToolCallScanner();
    scanner.push(
      `${JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              content:
                'const TOOL = "mcp__arij__get_ticket";\n' +
                JSON.stringify({ name: "mcp__arij__post_comment", type: "tool_use" }) +
                '\n{"path":"xd://mcp__arij_post_comment"}',
            },
          ],
        },
      })}\n`,
      "t1"
    );
    expect(parse).not.toHaveBeenCalled();
    expect(scanner.committed()).toEqual([]);
  });

  it("still finds an omp device path written with escaped slashes", () => {
    const scanner = createArijToolCallScanner();
    scanner.push(
      '{"type":"toolCall","id":"c1","name":"write","arguments":{"path":"xd:\\/\\/mcp__arij_get_ticket"}}\n',
      "t1"
    );
    expect(scanner.committed().map((c) => c.tool)).toEqual(["get_ticket"]);
  });

  it("does not JSON-parse lines that cannot hold an Arij call", () => {
    const parse = vi.spyOn(JSON, "parse");
    const scanner = createArijToolCallScanner();
    scanner.push(
      `${JSON.stringify({ type: "item.completed", text: "ran the tests" })}\n` +
        `${JSON.stringify({ server: "github", tool: "create_pr" })}\n`,
      "t1"
    );
    expect(parse).not.toHaveBeenCalled();

    scanner.push(
      `${JSON.stringify({ item: { server: "arij", tool: "get_ticket" } })}\n`,
      "t2"
    );
    expect(scanner.committed().map((c) => c.tool)).toEqual(["get_ticket"]);
  });
});
