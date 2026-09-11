/**
 * The one-shot trim of the history written before the write-path caps.
 *
 * The raw-stream cap in `appendChunk` fires on an append, so it bounds live
 * sessions and nothing else: on the live database ~780 MB of raw content sat
 * in sessions that had stopped writing before it shipped, and 38 prompts over
 * the 128 KiB prompt cap (lot 07, #70/#235). These tests pin:
 *   - the store walk (`trimRawStreamsOverCap`) applies the SAME trim as the
 *     write path to historical streams, idempotently, weighs outside the
 *     write lock, and stops at the first refusal of a locked database;
 *   - the boot pass (`runRawStreamBackfill`) runs once, caps prompts through
 *     the retention routine's backfiller, marks, and defers its one VACUUM to
 *     a moment with no active session — putting the debt back if it fails;
 *   - wired to the real store and settings table, a second boot is a no-op.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionChunkStore,
  type RawStreamsOverCapResult,
} from "@/lib/agent-sessions/chunks";
import {
  isRawStreamTrimMarker,
  SESSION_RAW_STREAM_TRIM_CHUNK_KEY,
} from "@/lib/agent-sessions/chunk-cap";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const {
  RAW_STREAM_BACKFILL_BUSY_TIMEOUT_MS,
  RAW_STREAM_BACKFILL_SETTING_KEY,
  RAW_STREAM_BACKFILL_VACUUM_DUE_SETTING_KEY,
  RAW_STREAM_BACKFILL_VACUUM_MIN_FREE_BYTES,
  RAW_STREAM_BACKFILL_VACUUM_QUIET_POLL_MS,
  defaultRawStreamBackfillDeps,
  runRawStreamBackfill,
  withBusyTimeout,
} = await import("@/lib/agent-sessions/raw-stream-backfill");

const SCHEMA = `
  CREATE TABLE agent_sessions (
    id text PRIMARY KEY NOT NULL,
    last_non_empty_text text
  );
  CREATE TABLE agent_session_sequences (
    session_id text PRIMARY KEY NOT NULL,
    next_sequence integer NOT NULL DEFAULT 1,
    updated_at text DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE agent_session_chunks (
    id text PRIMARY KEY NOT NULL,
    session_id text NOT NULL,
    stream_type text NOT NULL,
    sequence integer NOT NULL,
    chunk_key text,
    content text NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX agent_session_chunks_session_sequence_unique
    ON agent_session_chunks (session_id, sequence);
  CREATE UNIQUE INDEX agent_session_chunks_session_stream_key_unique
    ON agent_session_chunks (session_id, stream_type, chunk_key);
  CREATE INDEX agent_session_chunks_session_stream_sequence_idx
    ON agent_session_chunks (session_id, stream_type, sequence);
`;

const line = (i: number) => `${String(i).padStart(4, "0")}:${"x".repeat(94)}\n`;

/**
 * Rows written straight into SQLite — by a process that predates the cap —
 * so no store has ever counted them.
 */
function seedHistorical(
  db: Database.Database,
  sessionId: string,
  rows: number,
  streamType = "raw"
): void {
  db.prepare("INSERT OR IGNORE INTO agent_sessions (id) VALUES (?)").run(sessionId);
  const start =
    (db
      .prepare("SELECT coalesce(max(sequence), 0) AS s FROM agent_session_chunks WHERE session_id = ?")
      .get(sessionId) as { s: number }).s + 1;
  const insert = db.prepare(
    "INSERT INTO agent_session_chunks (id, session_id, stream_type, sequence, chunk_key, content) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < rows; i++) {
    const sequence = start + i;
    insert.run(`${sessionId}-${sequence}`, sessionId, streamType, sequence, `${streamType}:${sequence}`, line(i));
  }
  // Keep the sequence allocator ahead of the rows, as a real writer would.
  db.prepare(
    `INSERT INTO agent_session_sequences (session_id, next_sequence) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET next_sequence = excluded.next_sequence`
  ).run(sessionId, start + rows);
}

function rawRows(db: Database.Database, sessionId: string) {
  return db
    .prepare(
      "SELECT sequence, chunk_key AS chunkKey, content FROM agent_session_chunks WHERE session_id = ? AND stream_type = 'raw' ORDER BY sequence"
    )
    .all(sessionId) as Array<{ sequence: number; chunkKey: string | null; content: string }>;
}

function streamChars(db: Database.Database, sessionId: string, streamType = "raw"): number {
  return (
    db
      .prepare(
        "SELECT coalesce(sum(length(content)), 0) AS n FROM agent_session_chunks WHERE session_id = ? AND stream_type = ?"
      )
      .get(sessionId, streamType) as { n: number }
  ).n;
}

const CAP = { maxBytes: 2000, keptHeadChunks: 3, trimToRatio: 0.5 };

describe("store.trimRawStreamsOverCap — historical raw streams", () => {
  it("trims every stream over the cap with the write path's own trim, and nothing else", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    seedHistorical(db, "big", 40); // 4,000 chars against a 2,000 cap
    seedHistorical(db, "small", 5); // 500 chars, under the cap
    seedHistorical(db, "big", 30, "output"); // other streams are never touched
    const store = createSessionChunkStore(db, CAP);

    const result = store.trimRawStreamsOverCap();

    expect(result.scannedSessions).toBe(2);
    expect(result.trimmedSessions).toBe(1);
    expect(result.lockedSessions).toBe(0);
    expect(result.done).toBe(true);
    expect(result.droppedChunks).toBeGreaterThan(0);
    expect(result.droppedBytes).toBe(result.droppedChunks * 100);

    const rows = rawRows(db, "big");
    expect(rows.slice(0, 3).map((r) => r.chunkKey)).toEqual(["raw:1", "raw:2", "raw:3"]);
    expect(rows[3].chunkKey).toBe(SESSION_RAW_STREAM_TRIM_CHUNK_KEY);
    expect(isRawStreamTrimMarker(rows[3].content)).toBe(true);
    expect(rows[3].content).toContain(`${result.droppedChunks} chunks dropped`);
    expect(rows[rows.length - 1].chunkKey).toBe("raw:40");
    expect(streamChars(db, "big")).toBeLessThanOrEqual(CAP.maxBytes);

    expect(rawRows(db, "small")).toHaveLength(5);
    expect(streamChars(db, "big", "output")).toBe(3000);
  });

  it("is idempotent: a second walk finds every stream under the cap", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    seedHistorical(db, "big", 40);
    const store = createSessionChunkStore(db, CAP);
    store.trimRawStreamsOverCap();
    const after = rawRows(db, "big");

    // A fresh store too — the next boot has no running totals in memory.
    const second = createSessionChunkStore(db, CAP).trimRawStreamsOverCap();

    expect(second.trimmedSessions).toBe(0);
    expect(second.droppedChunks).toBe(0);
    expect(rawRows(db, "big")).toEqual(after);
  });

  it("walks in batches from a cursor and says when it is done", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    for (const id of ["a", "b", "c"]) seedHistorical(db, id, 40);
    const store = createSessionChunkStore(db, CAP);

    const first = store.trimRawStreamsOverCap({ maxSessions: 2 });
    expect(first).toMatchObject({ scannedSessions: 2, lastSessionId: "b", done: false });
    const second = store.trimRawStreamsOverCap({ afterSessionId: first.lastSessionId, maxSessions: 2 });
    expect(second).toMatchObject({ scannedSessions: 1, lastSessionId: "c", done: true });
    for (const id of ["a", "b", "c"]) {
      expect(streamChars(db, id)).toBeLessThanOrEqual(CAP.maxBytes);
    }
  });

  it("weighs each stream fresh, not from a running total another process made stale", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    seedHistorical(db, "big", 5);
    const store = createSessionChunkStore(db, CAP);
    // This process seeds its total at 600 chars…
    store.appendChunk({ sessionId: "big", streamType: "raw", content: line(50), chunkKey: "raw:50" });
    // …then another process writes 3,500 more behind its back.
    seedHistorical(db, "big", 35);

    const result = store.trimRawStreamsOverCap();
    expect(result.trimmedSessions).toBe(1);
    expect(streamChars(db, "big")).toBeLessThanOrEqual(CAP.maxBytes);

    // And the total it leaves behind is the trimmed one: one more row is
    // just one more row, not a second trim.
    const trimmedRows = rawRows(db, "big").length;
    store.appendChunk({ sessionId: "big", streamType: "raw", content: line(99), chunkKey: "raw:99" });
    expect(rawRows(db, "big")).toHaveLength(trimmedRows + 1);
  });

  describe("on a locked database", () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "raw-backfill-"));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("skips a session it cannot lock instead of throwing, and trims it once the lock is gone", () => {
      const file = path.join(dir, "arij.db");
      const setup = new Database(file);
      setup.pragma("journal_mode = WAL");
      setup.exec(SCHEMA);
      seedHistorical(setup, "big", 40);
      setup.close();

      // No busy wait: the refusal must come back at once, not after 5 s.
      const connection = new Database(file, { timeout: 0 });
      const holder = new Database(file, { timeout: 0 });
      const store = createSessionChunkStore(connection, CAP);

      holder.exec("BEGIN IMMEDIATE");
      let locked: RawStreamsOverCapResult | undefined;
      expect(() => {
        locked = store.trimRawStreamsOverCap();
      }).not.toThrow();
      expect(locked).toMatchObject({ scannedSessions: 1, lockedSessions: 1, trimmedSessions: 0 });
      holder.exec("ROLLBACK");
      expect(rawRows(connection, "big")).toHaveLength(40);

      const retry = store.trimRawStreamsOverCap();
      expect(retry).toMatchObject({ lockedSessions: 0, trimmedSessions: 1 });
      expect(streamChars(connection, "big")).toBeLessThanOrEqual(CAP.maxBytes);

      holder.close();
      connection.close();
    });

    it("stops at the first refusal, so a foreign lock costs one busy wait, not one per session", () => {
      const file = path.join(dir, "arij.db");
      const setup = new Database(file);
      setup.pragma("journal_mode = WAL");
      setup.exec(SCHEMA);
      for (const id of ["a", "b", "c", "d"]) seedHistorical(setup, id, 40);
      setup.close();

      // A real busy wait this time: the shared connection waits 5 s by
      // default, and the walk used to pay it once per session.
      const busyWaitMs = 150;
      const connection = new Database(file, { timeout: busyWaitMs });
      const holder = new Database(file, { timeout: 0 });
      const store = createSessionChunkStore(connection, CAP);

      holder.exec("BEGIN IMMEDIATE");
      const startedAt = performance.now();
      const locked = store.trimRawStreamsOverCap();
      const elapsed = performance.now() - startedAt;
      holder.exec("ROLLBACK");

      expect(locked).toMatchObject({
        lockedSessions: 1,
        trimmedSessions: 0,
        done: false,
        // Not advanced past the refused session: a resumed walk retries it.
        lastSessionId: null,
      });
      expect(elapsed).toBeGreaterThanOrEqual(busyWaitMs * 0.8);
      expect(elapsed).toBeLessThan(busyWaitMs * 2);

      holder.close();
      connection.close();
    });

    it("weighs outside the write lock: sessions under the cap never ask for it", () => {
      const file = path.join(dir, "arij.db");
      const setup = new Database(file);
      setup.pragma("journal_mode = WAL");
      setup.exec(SCHEMA);
      for (const id of ["a", "b", "c"]) seedHistorical(setup, id, 5);
      setup.close();

      const connection = new Database(file, { timeout: 0 });
      const holder = new Database(file, { timeout: 0 });
      const store = createSessionChunkStore(connection, CAP);

      holder.exec("BEGIN IMMEDIATE");
      const result = store.trimRawStreamsOverCap();
      holder.exec("ROLLBACK");

      expect(result).toMatchObject({ scannedSessions: 3, lockedSessions: 0, trimmedSessions: 0, done: true });

      holder.close();
      connection.close();
    });
  });

  it("hands the event loop back after each trimmed session when asked to", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    seedHistorical(db, "a", 5); // under the cap: weighed and passed over
    for (const id of ["b", "c"]) seedHistorical(db, id, 40);
    const store = createSessionChunkStore(db, CAP);

    const first = store.trimRawStreamsOverCap({ maxTrimmedSessions: 1 });
    expect(first).toMatchObject({ scannedSessions: 2, trimmedSessions: 1, lastSessionId: "b", done: false });
    const second = store.trimRawStreamsOverCap({ afterSessionId: "b", maxTrimmedSessions: 1 });
    expect(second).toMatchObject({ scannedSessions: 1, trimmedSessions: 1, lastSessionId: "c", done: true });
    const third = store.trimRawStreamsOverCap({ afterSessionId: "c", maxTrimmedSessions: 1 });
    expect(third).toMatchObject({ scannedSessions: 0, trimmedSessions: 0, done: true });
  });

  it("confirms a byte-heavy stream in characters before trimming it", () => {
    // The pre-weigh counts bytes (cheap, from the record header); the cap
    // counts characters. 1,000 two-byte characters weigh 2,000+ bytes and
    // sit under a 2,000-character cap: they must be left alone.
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    db.prepare("INSERT INTO agent_sessions (id) VALUES ('cjk')").run();
    const insert = db.prepare(
      "INSERT INTO agent_session_chunks (id, session_id, stream_type, sequence, chunk_key, content) VALUES (?, 'cjk', 'raw', ?, ?, ?)"
    );
    for (let i = 1; i <= 10; i++) insert.run(`cjk-${i}`, i, `raw:${i}`, "é".repeat(150));
    const store = createSessionChunkStore(db, CAP);

    const result = store.trimRawStreamsOverCap();

    expect(result).toMatchObject({ scannedSessions: 1, trimmedSessions: 0, droppedChunks: 0 });
    expect(rawRows(db, "cjk")).toHaveLength(10);
  });
});

function batch(overrides: Partial<RawStreamsOverCapResult> = {}): RawStreamsOverCapResult {
  return {
    scannedSessions: 1,
    trimmedSessions: 0,
    droppedChunks: 0,
    droppedBytes: 0,
    lockedSessions: 0,
    lastSessionId: "s",
    done: true,
    ...overrides,
  };
}

type PromptBatch = { projectId: string | null; cappedPrompts: number; reclaimedBytes: number; reachedRowBudget: boolean };

function fakeDeps(
  batches: Array<RawStreamsOverCapResult | Error>,
  options: {
    marks?: { trimmedAt?: string | null; vacuumDueAt?: string | null };
    free?: number;
    prompts?: Array<PromptBatch | Error>;
    quiet?: boolean[];
  } = {}
) {
  const calls: string[] = [];
  const queue = [...batches];
  const prompts = [...(options.prompts ?? [])];
  const quiet = [...(options.quiet ?? [])];
  const deps = {
    readMarks: vi.fn(() => ({
      trimmedAt: options.marks?.trimmedAt ?? null,
      vacuumDueAt: options.marks?.vacuumDueAt ?? null,
    })),
    writeMarks: vi.fn((patch: { trimmedAt?: string | null; vacuumDueAt?: string | null }) => {
      calls.push(`marks:${JSON.stringify(patch)}`);
    }),
    trimBatch: vi.fn((opts: { afterSessionId?: string | null; maxTrimmedSessions?: number }) => {
      calls.push(`trim:${opts.afterSessionId ?? ""}`);
      const next = queue.shift() ?? batch({ scannedSessions: 0 });
      if (next instanceof Error) throw next;
      return next;
    }),
    capPromptBatch: vi.fn((opts: { afterProjectId: string | null; maxRows: number }) => {
      calls.push(`prompts:${opts.afterProjectId ?? ""}`);
      const next = prompts.shift() ?? { projectId: null, cappedPrompts: 0, reclaimedBytes: 0, reachedRowBudget: false };
      if (next instanceof Error) throw next;
      return next;
    }),
    vacuum: vi.fn(() => {
      calls.push("vacuum");
    }),
    reclaimableBytes: vi.fn(() => options.free ?? 0),
    // Quiet unless told otherwise; each look consumes one answer.
    isQuiet: vi.fn(() => {
      const answer = quiet.length > 0 ? quiet.shift()! : true;
      calls.push(`quiet:${answer}`);
      return answer;
    }),
    pause: vi.fn(async () => {}),
    wait: vi.fn(async (ms: number) => {
      calls.push(`wait:${ms}`);
    }),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return { deps, calls };
}

const NOW = () => new Date("2026-09-11T08:00:00.000Z");
const AT = "2026-09-11T08:00:00.000Z";
const busyError = () => Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });

describe("runRawStreamBackfill — the one-shot boot pass", () => {
  it("does nothing once a previous boot recorded completion and owes no VACUUM", async () => {
    const { deps } = fakeDeps([], { marks: { trimmedAt: "2026-09-10T00:00:00.000Z" } });
    const result = await runRawStreamBackfill(deps, NOW);
    expect(result).toMatchObject({ status: "already-done", vacuumed: false, vacuumDue: false });
    expect(deps.trimBatch).not.toHaveBeenCalled();
    expect(deps.capPromptBatch).not.toHaveBeenCalled();
    expect(deps.wait).not.toHaveBeenCalled();
    expect(deps.vacuum).not.toHaveBeenCalled();
  });

  it("walks every batch, caps prompts, marks, and defers the VACUUM to a quiet moment", async () => {
    const { deps, calls } = fakeDeps(
      [
        batch({ scannedSessions: 8, trimmedSessions: 1, droppedChunks: 300, droppedBytes: 6 * 1024 * 1024, lastSessionId: "h", done: false }),
        batch({ scannedSessions: 3, trimmedSessions: 1, droppedChunks: 50, droppedBytes: 1024 * 1024, lastSessionId: "k", done: true }),
      ],
      {
        prompts: [
          { projectId: "p1", cappedPrompts: 8, reclaimedBytes: 2 * 1024 * 1024, reachedRowBudget: true },
          { projectId: "p1", cappedPrompts: 2, reclaimedBytes: 1024 * 1024, reachedRowBudget: false },
          { projectId: "p2", cappedPrompts: 1, reclaimedBytes: 1024 * 1024, reachedRowBudget: false },
        ],
        // Sessions are running at the first look: the rewrite waits.
        quiet: [false, true],
      }
    );

    const result = await runRawStreamBackfill(deps, NOW);

    expect(result).toMatchObject({
      status: "completed",
      scannedSessions: 11,
      trimmedSessions: 2,
      droppedChunks: 350,
      droppedBytes: 7 * 1024 * 1024,
      cappedPrompts: 11,
      promptBytesReclaimed: 4 * 1024 * 1024,
      vacuumed: true,
      vacuumDue: false,
    });
    expect(calls).toEqual([
      // Resumes from each batch's cursor; one trimmed session per call.
      "trim:",
      "trim:h",
      // The same project while it has rows left, then the next one.
      "prompts:",
      "prompts:",
      "prompts:p1",
      "prompts:p2",
      // Completion and the debt in one write.
      `marks:${JSON.stringify({ trimmedAt: AT, vacuumDueAt: AT })}`,
      `wait:${RAW_STREAM_BACKFILL_VACUUM_QUIET_POLL_MS}`,
      "quiet:false",
      `wait:${RAW_STREAM_BACKFILL_VACUUM_QUIET_POLL_MS}`,
      "quiet:true",
      // Claimed before the rewrite.
      `marks:${JSON.stringify({ vacuumDueAt: null })}`,
      "vacuum",
    ]);
    for (const call of deps.trimBatch.mock.calls) {
      expect(call[0]).toMatchObject({ maxTrimmedSessions: 1 });
    }
    const logged = deps.info.mock.calls.map(([message]) => message).join("\n");
    expect(logged).toContain("350 raw rows");
    expect(logged).toContain("7.0 MiB");
    expect(logged).toContain("2 of 11 sessions trimmed");
    expect(logged).toContain("11 prompts capped");
  });

  it("stops at the first refusal, unmarked, and never reaches the prompts or the VACUUM", async () => {
    const { deps } = fakeDeps([
      batch({ droppedChunks: 10, droppedBytes: 1000, lastSessionId: "a", done: false }),
      batch({ lockedSessions: 1, lastSessionId: "a", done: false }),
      batch({ lastSessionId: "z", done: true }),
    ]);
    const result = await runRawStreamBackfill(deps, NOW);
    expect(result).toMatchObject({ status: "incomplete", lockedSessions: 1 });
    expect(deps.trimBatch).toHaveBeenCalledTimes(2);
    expect(deps.capPromptBatch).not.toHaveBeenCalled();
    expect(deps.writeMarks).not.toHaveBeenCalled();
    expect(deps.vacuum).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("locked"));
  });

  it("never throws: a failing walk, a failing prompt cap or an unreadable mark is an incomplete run", async () => {
    const failing = fakeDeps([new Error("disk I/O error")]);
    await expect(runRawStreamBackfill(failing.deps, NOW)).resolves.toMatchObject({ status: "incomplete" });
    expect(failing.deps.writeMarks).not.toHaveBeenCalled();

    const prompts = fakeDeps([batch()], { prompts: [busyError()] });
    await expect(runRawStreamBackfill(prompts.deps, NOW)).resolves.toMatchObject({ status: "incomplete" });
    expect(prompts.deps.writeMarks).not.toHaveBeenCalled();
    expect(prompts.deps.warn).toHaveBeenCalledWith(expect.stringContaining("busy"));

    const busy = fakeDeps([]);
    busy.deps.readMarks.mockImplementation(() => {
      throw busyError();
    });
    await expect(runRawStreamBackfill(busy.deps, NOW)).resolves.toMatchObject({ status: "incomplete" });
    expect(busy.deps.trimBatch).not.toHaveBeenCalled();
  });

  it("owes nothing when nothing was dropped and the free list is small", async () => {
    const { deps } = fakeDeps([batch()], { free: 4096 });
    const result = await runRawStreamBackfill(deps, NOW);
    expect(result).toMatchObject({ status: "completed", vacuumed: false, vacuumDue: false });
    expect(deps.writeMarks).toHaveBeenCalledExactlyOnceWith({ trimmedAt: AT });
    expect(deps.wait).not.toHaveBeenCalled();
    expect(deps.vacuum).not.toHaveBeenCalled();
  });

  it("still reclaims what an earlier, incomplete boot deleted", async () => {
    // The finishing run drops nothing itself; the debt is on the free list.
    const { deps } = fakeDeps([batch()], { free: RAW_STREAM_BACKFILL_VACUUM_MIN_FREE_BYTES });
    const result = await runRawStreamBackfill(deps, NOW);
    expect(result.vacuumed).toBe(true);
    expect(deps.vacuum).toHaveBeenCalledOnce();
  });

  it("puts the debt back when the VACUUM fails, and a later boot settles it", async () => {
    const first = fakeDeps([batch({ trimmedSessions: 1, droppedChunks: 5, droppedBytes: 500 })]);
    first.deps.vacuum.mockImplementation(() => {
      throw busyError();
    });
    const failed = await runRawStreamBackfill(first.deps, NOW);
    expect(failed).toMatchObject({ status: "completed", vacuumed: false, vacuumDue: true });
    expect(first.deps.writeMarks.mock.calls.map(([patch]) => patch)).toEqual([
      { trimmedAt: AT, vacuumDueAt: AT },
      { vacuumDueAt: null },
      { vacuumDueAt: AT },
    ]);
    expect(first.deps.warn).toHaveBeenCalledWith(expect.stringContaining("later boot will retry"));

    // Next boot: the walk is done, only the debt remains.
    const second = fakeDeps([], { marks: { trimmedAt: AT, vacuumDueAt: AT } });
    const settled = await runRawStreamBackfill(second.deps, NOW);
    expect(settled).toMatchObject({ status: "already-done", vacuumed: true, vacuumDue: false });
    expect(second.deps.trimBatch).not.toHaveBeenCalled();
    expect(second.deps.vacuum).toHaveBeenCalledOnce();
  });

  it("says how to reclaim by hand when even the debt cannot be put back", async () => {
    const { deps } = fakeDeps([batch({ trimmedSessions: 1, droppedChunks: 5, droppedBytes: 500 })]);
    deps.vacuum.mockImplementation(() => {
      throw busyError();
    });
    deps.writeMarks
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw busyError();
      });
    const result = await runRawStreamBackfill(deps, NOW);
    expect(result).toMatchObject({ status: "completed", vacuumed: false });
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining("sqlite3 data/arij.db 'VACUUM;'"));
  });
});

describe("withBusyTimeout", () => {
  it("lowers the busy wait for the call only, and restores it after a throw", () => {
    const connection = new Database(":memory:", { timeout: 5000 });
    const read = () => Number(connection.pragma("busy_timeout", { simple: true }));

    expect(withBusyTimeout(connection, RAW_STREAM_BACKFILL_BUSY_TIMEOUT_MS, read)).toBe(RAW_STREAM_BACKFILL_BUSY_TIMEOUT_MS);
    expect(read()).toBe(5000);
    expect(() =>
      withBusyTimeout(connection, 10, () => {
        throw busyError();
      })
    ).toThrow("database is locked");
    expect(read()).toBe(5000);
    connection.close();
  });
});

describe("runRawStreamBackfill — wired to the real store and settings", () => {
  it("trims raw and prompts once, vacuums when sessions are idle, and is a no-op on the next boot", async () => {
    const { db, sqlite } = await import("@/lib/db");
    const { agentSessions, projects, settings } = await import("@/lib/db/schema");
    const { SESSION_RAW_STREAM_MAX_BYTES } = await import("@/lib/agent-sessions/chunk-cap");
    const { SESSION_PROMPT_MAX_STORED_BYTES, SESSION_PROMPT_ELISION_LABEL } = await import(
      "@/lib/agent-sessions/prompt-cap"
    );
    const { eq, inArray } = await import("drizzle-orm");

    db.insert(projects).values({ id: "p1", name: "P" }).run();
    db.insert(agentSessions)
      .values([
        // A pre-cap prompt of 300 KiB against the 128 KiB cap.
        { id: "heavy", projectId: "p1", status: "completed", prompt: "p".repeat(300 * 1024) },
        { id: "live", projectId: "p1", status: "running", prompt: "short" },
      ])
      .run();
    // 60 historical rows of 100 KiB: 6 MiB against the 4 MiB cap.
    const insert = sqlite.prepare(
      "INSERT INTO agent_session_chunks (id, session_id, stream_type, sequence, chunk_key, content) VALUES (?, 'heavy', 'raw', ?, ?, ?)"
    );
    for (let i = 1; i <= 60; i++) insert.run(`h-${i}`, i, `stdout:${i}`, "y".repeat(100 * 1024));

    const busyTimeoutBefore = Number(sqlite.pragma("busy_timeout", { simple: true }));
    // The running session holds the VACUUM back: it is still running at the
    // first look, and ends during the second wait.
    let waits = 0;
    const wait = vi.fn(async () => {
      waits += 1;
      if (waits < 2) return;
      db.update(agentSessions).set({ status: "completed" }).where(eq(agentSessions.id, "live")).run();
    });
    const vacuum = vi.fn(() => defaultRawStreamBackfillDeps.vacuum());
    const info = vi.fn<(message: string) => void>();
    const quietDeps = { ...defaultRawStreamBackfillDeps, info, warn: vi.fn(), wait, vacuum };

    const first = await runRawStreamBackfill(quietDeps);
    expect(first).toMatchObject({
      status: "completed",
      trimmedSessions: 1,
      cappedPrompts: 1,
      vacuumed: true,
      vacuumDue: false,
    });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(vacuum).toHaveBeenCalledOnce();
    expect(streamChars(sqlite, "heavy")).toBeLessThanOrEqual(SESSION_RAW_STREAM_MAX_BYTES);
    const prompt = db.select({ prompt: agentSessions.prompt }).from(agentSessions).where(eq(agentSessions.id, "heavy")).get()!.prompt!;
    expect(Buffer.byteLength(prompt)).toBeLessThan(SESSION_PROMPT_MAX_STORED_BYTES);
    expect(prompt).toContain(SESSION_PROMPT_ELISION_LABEL);
    // The pass lowered the shared busy wait only while it held the connection.
    expect(Number(sqlite.pragma("busy_timeout", { simple: true }))).toBe(busyTimeoutBefore);

    const marks = db
      .select()
      .from(settings)
      .where(inArray(settings.key, [RAW_STREAM_BACKFILL_SETTING_KEY, RAW_STREAM_BACKFILL_VACUUM_DUE_SETTING_KEY]))
      .all();
    // Completion stays; the debt is gone once paid.
    expect(marks.map((row) => row.key)).toEqual([RAW_STREAM_BACKFILL_SETTING_KEY]);
    expect(typeof JSON.parse(marks[0].value)).toBe("string");
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/1 of 1 sessions trimmed, \d+ raw rows/));

    const second = await runRawStreamBackfill(quietDeps);
    expect(second).toMatchObject({ status: "already-done", vacuumed: false });
    expect(vacuum).toHaveBeenCalledOnce();
  });

  it("holds the shared connection with a short busy wait for every write it makes", async () => {
    const { sqlite } = await import("@/lib/db");
    const pragma = vi.spyOn(sqlite, "pragma");
    try {
      defaultRawStreamBackfillDeps.trimBatch({ maxSessions: 1 });
      defaultRawStreamBackfillDeps.capPromptBatch({ afterProjectId: null, maxRows: 1 });
      defaultRawStreamBackfillDeps.writeMarks({ vacuumDueAt: null });
      defaultRawStreamBackfillDeps.vacuum();
      const lowered = pragma.mock.calls.filter(
        ([source]) => source === `busy_timeout = ${RAW_STREAM_BACKFILL_BUSY_TIMEOUT_MS}`
      );
      expect(lowered).toHaveLength(4);
    } finally {
      pragma.mockRestore();
    }
  });
});
