/**
 * `GET /api/projects/:projectId/sessions/:sessionId` — the bounded payload.
 *
 * Before: the handler returned the whole row (prompt included), the entire
 * `logs.json` parsed into memory, and all three chunk streams in full. On the
 * live database that is 112 MB for the worst session and over 5 MB for 19 of
 * them. better-sqlite3 is synchronous on one shared connection, so that read
 * blocked every other API request, every SSE heartbeat and the Full Auto
 * sweep for as long as it took — an availability problem, not a slow page.
 *
 * These tests pin the three bounds that replaced it (prompt opt-in, capped
 * logs, paged streams), the cursor contract that keeps the output reachable,
 * and the failure flags that used to be silent nulls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: { cancel: vi.fn() },
}));
vi.mock("@/lib/agents/scheduler", () => ({
  agentScheduler: { remove: vi.fn() },
}));
vi.mock("@/lib/activity-registry", () => ({
  activityRegistry: { cancelInProject: vi.fn(() => false) },
}));
vi.mock("@/lib/agent-sessions/backfill", () => ({
  runBackfillRecentSessionLastNonEmptyTextOnce: vi.fn(),
}));

const { db } = await import("@/lib/db");
const { projects, agentSessions } = await import("@/lib/db/schema");
const { appendSessionChunk } = await import("@/lib/agent-sessions/chunks");
const { seedLegacyChunks } = await import("@/__tests__/helpers/legacy-chunks");
const { GET } = await import(
  "@/app/api/projects/[projectId]/sessions/[sessionId]/route"
);
const { SESSION_LOGS_MAX_SERVED_BYTES } = await import(
  "@/lib/agent-sessions/session-detail"
);

const PROJECT = "proj-1";
const SESSION = "sess-1";
const OTHER_PROJECT = "proj-2";

let tempDir: string;

function get(
  searchParams: Record<string, string> = {},
  ids: { projectId?: string; sessionId?: string } = {}
) {
  return GET(
    mockNextRequest({ searchParams }),
    mockRouteContext({
      projectId: ids.projectId ?? PROJECT,
      sessionId: ids.sessionId ?? SESSION,
    })
  );
}

const getDetail = get;

function seedChunks(streamType: "raw" | "output" | "response", contents: string[]) {
  for (const content of contents) {
    appendSessionChunk({ sessionId: SESSION, streamType, content });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-session-detail-"));
  db.delete(agentSessions).run();
  db.delete(projects).run();
  db.insert(projects).values({ id: PROJECT, name: "One" }).run();
  db.insert(projects).values({ id: OTHER_PROJECT, name: "Two" }).run();
  db.insert(agentSessions)
    .values({
      id: SESSION,
      projectId: PROJECT,
      status: "completed",
      agentType: "build",
      prompt: "the full dispatch prompt",
      createdAt: new Date().toISOString(),
    })
    .run();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("prompt is opt-in", () => {
  it("omits the prompt by default", async () => {
    const json = await (await get()).json();

    expect(json.data.id).toBe(SESSION);
    expect(json.data.prompt).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("the full dispatch prompt");
  });

  it("returns it on ?include=prompt", async () => {
    const json = await (await get({ include: "prompt" })).json();

    expect(json.data.prompt).toBe("the full dispatch prompt");
  });

  it("still serves the rest of the row when the prompt is left out", async () => {
    const json = await (await get()).json();

    // The projection is derived from the table minus one column: everything
    // the detail page renders has to survive it.
    expect(json.data.status).toBe("completed");
    expect(json.data.agentType).toBe("build");
    expect(json.data).toHaveProperty("branchName");
    expect(json.data).toHaveProperty("totalCostUsd");
    expect(json.data).toHaveProperty("cliSessionId");
  });
});

describe("chunk streams", () => {
  it("embeds a bounded preview of each stream, with a cursor for the rest", async () => {
    seedChunks("raw", Array.from({ length: 50 }, (_, i) => `raw-${i}`));
    seedChunks("output", Array.from({ length: 30 }, (_, i) => `out-${i}`));

    const json = await (await get()).json();

    // `output` keeps its HEAD preview: 20 chunks, the rest behind `after`.
    expect(json.data.chunkStreams.output.chunks).toHaveLength(20);
    expect(json.data.chunkStreams.output.chunks[0].content).toBe("out-0");
    expect(json.data.chunkStreams.output.hasMore).toBe(true);
    expect(json.data.chunkStreams.response.chunks).toEqual([]);
    expect(json.data.chunkStreamsUnavailable).toBeUndefined();
  });

  it("seeds the raw stream with its END, not its head", async () => {
    // A finished 112 MB session used to open on its first 64 KiB, ~108
    // "Load more" clicks away from the end the LIVE LOG is about.
    seedChunks("raw", Array.from({ length: 50 }, (_, i) => `raw-${i}`));

    const raw = (await (await get()).json()).data.chunkStreams.raw;

    expect(raw.chunks.map((c: { content: string }) => c.content)).toEqual(
      Array.from({ length: 20 }, (_, i) => `raw-${30 + i}`)
    );
    expect(raw.hasEarlier).toBe(true);
    expect(raw.firstSequence).toBe(raw.chunks[0].sequence);
    expect(raw.firstOffset).toBe(0);
    expect(raw.lastSequence).toBe(raw.chunks[19].sequence);
    // Nothing follows the end: a live follow resumes from the last sequence.
    expect(raw.hasMore).toBe(false);
    expect(raw.nextAfter).toBe(raw.lastSequence);
    expect(raw.nextOffset).toBe(0);
  });

  it("follows a live session forward from the tail's cursor", async () => {
    seedChunks("raw", Array.from({ length: 30 }, (_, i) => `raw-${i}`));
    const raw = (await (await get()).json()).data.chunkStreams.raw;

    seedChunks("raw", ["fresh-1", "fresh-2"]);
    const next = await (
      await get({ stream: "raw", after: String(raw.nextAfter) })
    ).json();

    expect(next.data.chunks.map((c: { content: string }) => c.content)).toEqual([
      "fresh-1",
      "fresh-2",
    ]);
  });

  it("pages towards the head on ?stream=raw&before=", async () => {
    seedChunks("raw", Array.from({ length: 50 }, (_, i) => `raw-${i}`));
    const raw = (await (await get()).json()).data.chunkStreams.raw;

    const earlier = await (
      await get({ stream: "raw", before: String(raw.firstSequence), limit: "25" })
    ).json();

    expect(earlier.data.streamType).toBe("raw");
    expect(earlier.data.chunks.map((c: { content: string }) => c.content)).toEqual(
      Array.from({ length: 25 }, (_, i) => `raw-${5 + i}`)
    );
    expect(earlier.data.hasEarlier).toBe(true);
    expect(earlier.data).not.toHaveProperty("logs");

    const head = await (
      await get({
        stream: "raw",
        before: String(earlier.data.firstSequence),
        beforeOffset: String(earlier.data.firstOffset),
      })
    ).json();
    expect(head.data.chunks.map((c: { content: string }) => c.content)).toEqual(
      Array.from({ length: 5 }, (_, i) => `raw-${i}`)
    );
    expect(head.data.hasEarlier).toBe(false);
  });

  it("walks a legacy oversized raw row out backwards, exactly once", async () => {
    const blob = Array.from({ length: 700_000 }, (_, i) =>
      String.fromCharCode(97 + (i % 26))
    ).join("");
    seedLegacyChunks(SESSION, "raw", ["head|", blob, "|tail"]);

    let page = (await (await get()).json()).data.chunkStreams.raw;
    // The seed is still bounded: the end of the blob, never the blob.
    expect(Buffer.byteLength(JSON.stringify(page), "utf-8")).toBeLessThan(80 * 1024);
    const parts: string[] = [page.chunks.map((c: { content: string }) => c.content).join("")];
    for (let guard = 0; page.hasEarlier && guard < 40; guard++) {
      page = (
        await (
          await get({
            stream: "raw",
            before: String(page.firstSequence),
            beforeOffset: String(page.firstOffset),
          })
        ).json()
      ).data;
      parts.unshift(page.chunks.map((c: { content: string }) => c.content).join(""));
    }

    expect(parts.join("")).toBe(`head|${blob}|tail`);
  });

  it("refuses after and before on the same stream page", async () => {
    const response = await get({ stream: "raw", after: "1", before: "5" });
    expect(response.status).toBe(400);
  });

  it("refuses a before cursor it cannot read instead of paging from the head", async () => {
    seedChunks("raw", ["a", "b", "c"]);
    // A garbled cursor used to fall through to the forward branch and answer
    // with a HEAD page in the wrong shape — no firstSequence, no hasEarlier.
    for (const before of ["abc", "-1", ""]) {
      const response = await get({ stream: "raw", before });
      expect(response.status).toBe(400);
    }
  });

  it("serves one stream on ?stream=, with after/limit", async () => {
    seedChunks("raw", ["a", "b", "c", "d"]);
    seedChunks("output", ["ignored"]);

    const first = await (await get({ stream: "raw", limit: "2" })).json();
    expect(first.data.streamType).toBe("raw");
    expect(first.data.chunks.map((c: { content: string }) => c.content)).toEqual(["a", "b"]);
    expect(first.data.hasMore).toBe(true);
    // A stream page is only that stream — and only that stream's bytes.
    expect(first.data).not.toHaveProperty("logs");
    expect(first.data).not.toHaveProperty("chunkStreams");

    const second = await (
      await get({ stream: "raw", limit: "2", after: String(first.data.nextAfter) })
    ).json();
    expect(second.data.chunks.map((c: { content: string }) => c.content)).toEqual(["c", "d"]);
    expect(second.data.hasMore).toBe(false);
  });

  it("delivers the whole stream across pages, exactly once", async () => {
    const contents = Array.from({ length: 25 }, (_, i) => `chunk-${i}`);
    seedChunks("output", contents);

    const seen: string[] = [];
    let after: number | null = null;
    for (let page = 0; page < 30; page++) {
      const url: Record<string, string> = { stream: "output", limit: "4" };
      if (after !== null) url.after = String(after);
      const json = await (await get(url)).json();
      seen.push(...json.data.chunks.map((c: { content: string }) => c.content));
      after = json.data.nextAfter;
      if (!json.data.hasMore) break;
    }

    expect(seen).toEqual(contents);
  });

  it("walks a single oversized chunk out through the offset cursor", async () => {
    // The live database holds one 8.3 MB chunk — a CLI result blob written in
    // one piece. No row limit bounds that, so the cursor carries how much of
    // the chunk went out and the rest comes on the next page.
    const blob = Array.from({ length: 700_000 }, (_, i) =>
      String.fromCharCode(97 + (i % 26))
    ).join("");
    // Past the store: the write-path cap would trim this to 256 KiB, and the
    // row this test is about is a legacy one written before the cap existed.
    seedLegacyChunks(SESSION, "response", [blob, "|tail"]);

    let after: number | null = null;
    let offset = 0;
    let assembled = "";
    let pages = 0;
    for (; pages < 60; pages++) {
      const url: Record<string, string> = { stream: "response", limit: "50" };
      if (after !== null) url.after = String(after);
      if (offset) url.offset = String(offset);
      const json = await (await get(url)).json();
      assembled += json.data.chunks
        .map((c: { content: string }) => c.content)
        .join("");
      after = json.data.nextAfter;
      offset = json.data.nextOffset;
      if (!json.data.hasMore) break;
    }

    // Every byte is reachable, exactly once — and it genuinely took several
    // pages, so the walk, not the size of the fixture, is what was tested.
    expect(assembled).toBe(`${blob}|tail`);
    expect(pages).toBeGreaterThanOrEqual(2);
  });

  it("rejects an unknown stream name", async () => {
    const response = await get({ stream: "stdout" });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stdout");
  });

  it("keeps the project scope on a stream page", async () => {
    seedChunks("raw", ["secret output"]);

    const response = await get(
      { stream: "raw" },
      { projectId: OTHER_PROJECT }
    );

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("secret output");
  });
});

describe("the poll can leave the stream previews out", () => {
  it("reads no chunk at all on ?omit=streams, and serves the rest of the row", async () => {
    seedChunks("raw", ["a", "b"]);
    seedChunks("output", ["out"]);
    const chunks = await import("@/lib/agent-sessions/chunks");
    const page = vi.spyOn(chunks, "listSessionChunkPage");
    const tail = vi.spyOn(chunks, "listSessionChunkTail");

    const json = await (await get({ omit: "streams" })).json();

    expect(page).not.toHaveBeenCalled();
    expect(tail).not.toHaveBeenCalled();
    expect(json.data.chunkStreams).toBeUndefined();
    expect(json.data.chunkStreamsUnavailable).toBeUndefined();
    expect(json.data.status).toBe("completed");
    expect(json.data).toHaveProperty("lastNonEmptyText");
  });

  it("still previews every stream by default", async () => {
    seedChunks("raw", ["a"]);
    const json = await (await get()).json();
    expect(json.data.chunkStreams.raw.chunks).toHaveLength(1);
    expect(json.data.chunkStreams.output).toBeDefined();
    expect(json.data.chunkStreams.response).toBeDefined();
  });
});

describe("the last-text backfill is off the request path", () => {
  it("does not run on a detail GET, a stream page or the actions view", async () => {
    const backfill = await import("@/lib/agent-sessions/backfill");
    const run = vi.mocked(backfill.runBackfillRecentSessionLastNonEmptyTextOnce);
    run.mockClear();

    await get();
    await get({ stream: "raw", after: "0" });
    await get({ view: "arij-actions" });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("logs.json is opt-in", () => {
  it("is neither read nor served by the default payload", async () => {
    // The default payload is what the live page polls every 3 seconds; the
    // same text is in the `response` stream and in `lastNonEmptyText`.
    const logsPath = path.join(tempDir, "logs.json");
    fs.writeFileSync(logsPath, JSON.stringify({ success: true, result: "all done" }));
    db.update(agentSessions).set({ logsPath }).run();
    const read = vi.spyOn(fs, "readFileSync");

    const json = await (await get()).json();

    expect(json.data).not.toHaveProperty("logs");
    expect(json.data).not.toHaveProperty("logsTruncated");
    expect(json.data).not.toHaveProperty("logsUnavailable");
    // The row's pointer is still there, so a client knows logs exist.
    expect(json.data.logsPath).toBe(logsPath);
    expect(read.mock.calls.some(([file]) => String(file) === logsPath)).toBe(false);
  });

  it("does not flag an unreadable logs.json it was not asked for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logsPath = path.join(tempDir, "logs.json");
    fs.writeFileSync(logsPath, "{ not json");
    db.update(agentSessions).set({ logsPath }).run();

    const json = await (await get()).json();

    expect(json.data).not.toHaveProperty("logsUnavailable");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("logs are bounded", () => {
  function writeLogs(body: unknown): void {
    const logsPath = path.join(tempDir, "logs.json");
    fs.writeFileSync(logsPath, JSON.stringify(body));
    db.update(agentSessions).set({ logsPath }).run();
  }

  // Everything below asks for the document, as the export button does.
  function get(searchParams: Record<string, string> = {}) {
    return getDetail({ include: "logs", ...searchParams });
  }

  it("serves a small logs.json untouched", async () => {
    writeLogs({ success: true, result: "all done", duration: 12 });

    const json = await (await get()).json();

    expect(json.data.logs.result).toBe("all done");
    expect(json.data.logsTruncated).toBe(false);
  });

  it("caps an oversized result and says so, in the payload and in the text", async () => {
    writeLogs({ success: true, result: "x".repeat(400 * 1024) });

    const json = await (await get()).json();

    expect(json.data.logsTruncated).toBe(true);
    expect(json.data.logs.result.length).toBeLessThan(400 * 1024);
    expect(json.data.logs.result).toContain("truncated");
  });

  it("refuses to parse a logs.json past the file cap", async () => {
    // 8.6 MB is the largest on the live database; parsing it blocks the
    // process for every other caller.
    writeLogs({ success: true, result: "y".repeat(5 * 1024 * 1024) });

    const json = await (await get()).json();

    expect(json.data.logs).toBeNull();
    expect(json.data.logsTruncated).toBe(true);
    expect(json.data.logsUnavailable).toBeUndefined();
  });

  it("measures the served-bytes ceiling in bytes, not UTF-16 units", async () => {
    // A legacy array-shaped log, so the `result` cap does not apply and only
    // the shape-agnostic backstop stands between this and the response.
    //
    // Each of these characters is ONE UTF-16 unit and THREE UTF-8 bytes:
    // 300k of them serialise to ~300k units — comfortably under the 512 KiB
    // ceiling if you count `.length` — and ~900 KB on the wire. Counting
    // units let a document nearly twice the ceiling through.
    const cjk = "漢".repeat(300_000);
    writeLogs([cjk]);
    expect(JSON.stringify([cjk]).length).toBeLessThan(
      SESSION_LOGS_MAX_SERVED_BYTES
    );
    expect(
      Buffer.byteLength(JSON.stringify([cjk]), "utf-8")
    ).toBeGreaterThan(SESSION_LOGS_MAX_SERVED_BYTES);

    const response = await get();
    const json = await response.json();

    expect(json.data.logs).toBeNull();
    expect(json.data.logsTruncated).toBe(true);
    // And the combined payload keeps its contract, which is a byte contract.
    expect(
      Buffer.byteLength(JSON.stringify(json), "utf-8")
    ).toBeLessThan(2 * 1024 * 1024);
  });

  it("still serves a multibyte log that fits", async () => {
    // The bound must not become "no CJK logs": one that fits in bytes comes
    // through whole.
    writeLogs({ success: true, result: "漢字".repeat(1000) });

    const json = await (await get()).json();

    expect(json.data.logs.result).toBe("漢字".repeat(1000));
    expect(json.data.logsTruncated).toBe(false);
  });

  it("flags an unreadable logs.json instead of passing it off as empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logsPath = path.join(tempDir, "logs.json");
    fs.writeFileSync(logsPath, "{ not json");
    db.update(agentSessions).set({ logsPath }).run();

    const json = await (await get()).json();

    expect(json.data.logs).toBeNull();
    expect(json.data.logsUnavailable).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe("worst-case payload", () => {
  it("stays under 2 MB for a session whose streams are tens of megabytes", async () => {
    // Shaped after session ZZAP6QWzM-Ss on the live database: ~3,000 raw
    // chunks totalling 112 MB, plus one 8.3 MB response blob written as a
    // single chunk, plus a 1.8 MB prompt.
    db.update(agentSessions)
      .set({ prompt: "p".repeat(1_800_000) })
      .run();
    // Distinct per chunk, at an identical size — 200 copies of one blob is
    // one row now that keyless chunks dedupe on their content.
    seedChunks(
      "raw",
      Array.from(
        { length: 200 },
        (_, i) => "r".repeat(64 * 1024 - 4) + String(i).padStart(4, "0")
      )
    );
    seedLegacyChunks(SESSION, "response", ["R".repeat(8_300_000)]);
    // One 4 MB line with no newline in it. The CHUNK is capped on the way in
    // now, but `last_non_empty_text` is deliberately derived from the uncapped
    // text — so the derived column is still what an unbounded preview column
    // looks like, and the route is what has to bound it.
    seedChunks("output", ["o".repeat(4_000_000)]);
    const logsPath = path.join(tempDir, "logs.json");
    fs.writeFileSync(
      logsPath,
      JSON.stringify({ success: true, result: "L".repeat(3_000_000) })
    );
    db.update(agentSessions).set({ logsPath }).run();

    const detail = await (await get()).json();
    const detailBytes = Buffer.byteLength(JSON.stringify(detail), "utf-8");
    expect(detailBytes).toBeLessThan(2 * 1024 * 1024);
    // Asking for the logs too keeps the byte contract.
    const withLogs = await (await get({ include: "logs" })).json();
    expect(
      Buffer.byteLength(JSON.stringify(withLogs), "utf-8")
    ).toBeLessThan(2 * 1024 * 1024);

    // …and so does a full-size page of the worst stream.
    expect(detail.data.lastNonEmptyText.length).toBeLessThan(5000);

    const page = await (await get({ stream: "raw", limit: "1000" })).json();
    const pageBytes = Buffer.byteLength(JSON.stringify(page), "utf-8");
    expect(pageBytes).toBeLessThan(2 * 1024 * 1024);
    expect(page.data.hasMore).toBe(true);

    // The single 8.3 MB response chunk comes out in slices, with the cursor
    // pointing into it — not skipped, and never shipped whole.
    const response = await (await get({ stream: "response" })).json();
    expect(response.data.chunks).toHaveLength(1);
    expect(response.data.chunks[0].contentTruncated).toBe(true);
    expect(response.data.chunks[0].contentLength).toBe(8_300_000);
    expect(response.data.nextOffset).toBeGreaterThan(0);
    expect(response.data.hasMore).toBe(true);
    expect(
      Buffer.byteLength(JSON.stringify(response), "utf-8")
    ).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("chunk-read failures are explicit", () => {
  it("logs a warning and flags the payload instead of returning null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunks = await import("@/lib/agent-sessions/chunks");
    vi.spyOn(chunks, "listSessionChunkPage").mockImplementation(() => {
      throw new Error("chunk table is damaged");
    });
    vi.spyOn(chunks, "listSessionChunkTail").mockImplementation(() => {
      throw new Error("chunk table is damaged");
    });

    const json = await (await get()).json();

    expect(json.data.chunkStreamsUnavailable).toBe(true);
    expect(json.data.chunkStreams.raw.chunks).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to read the raw stream"),
      expect.any(Error)
    );
  });

  it("flags it on a stream page too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunks = await import("@/lib/agent-sessions/chunks");
    vi.spyOn(chunks, "listSessionChunkPage").mockImplementation(() => {
      throw new Error("chunk table is damaged");
    });

    const json = await (await get({ stream: "output", after: "7" })).json();

    expect(json.data.chunkStreamsUnavailable).toBe(true);
    expect(json.data.chunks).toEqual([]);
    // The cursor comes back unchanged: the client resumes where it was, and
    // does not restart the stream from the beginning.
    expect(json.data.nextAfter).toBe(7);
  });

  it("flags it on a before page, with the cursor unchanged", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunks = await import("@/lib/agent-sessions/chunks");
    vi.spyOn(chunks, "listSessionChunkTail").mockImplementation(() => {
      throw new Error("chunk table is damaged");
    });

    const json = await (
      await get({ stream: "raw", before: "40", beforeOffset: "12" })
    ).json();

    expect(json.data.chunkStreamsUnavailable).toBe(true);
    expect(json.data.chunks).toEqual([]);
    expect(json.data.firstSequence).toBe(40);
    expect(json.data.firstOffset).toBe(12);
    expect(json.data.hasEarlier).toBe(true);
  });
});
