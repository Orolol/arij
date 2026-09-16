/**
 * The per-session cap on the raw stream, and the two tail readers.
 *
 * Measured before the cap (2026-09-11): 869 MB of raw chunks, 90 % of it in
 * 37 sessions above 4 MiB written in one afternoon. A time-based retention
 * cannot reach that shape, so the bound lives on the write path: past the
 * cap, the oldest rows after a kept head are dropped and one marker row says
 * how much went. The tail readers are what the LIVE LOG and the forensic
 * prompt want — the end of the stream — without materialising the whole of
 * it.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  createSessionChunkStore,
  type SessionChunkStore,
} from "@/lib/agent-sessions/chunks";
import {
  isRawStreamTrimMarker,
  SESSION_RAW_STREAM_TRIM_CHUNK_KEY,
} from "@/lib/agent-sessions/chunk-cap";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE agent_sessions (
      id text PRIMARY KEY NOT NULL,
      last_non_empty_text text
    );
    CREATE TABLE agent_session_sequences (
      session_id text PRIMARY KEY NOT NULL,
      next_sequence integer NOT NULL DEFAULT 1,
      updated_at text DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE cascade
    );
    CREATE TABLE agent_session_chunks (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      stream_type text NOT NULL,
      sequence integer NOT NULL,
      chunk_key text,
      content text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX agent_session_chunks_session_sequence_unique
      ON agent_session_chunks (session_id, sequence);
    CREATE UNIQUE INDEX agent_session_chunks_session_stream_key_unique
      ON agent_session_chunks (session_id, stream_type, chunk_key);
    CREATE INDEX agent_session_chunks_session_stream_sequence_idx
      ON agent_session_chunks (session_id, stream_type, sequence);
  `);
  db.prepare("INSERT INTO agent_sessions (id) VALUES ('s1'), ('s2')").run();
  return db;
}

function rawRows(db: Database.Database, sessionId = "s1") {
  return db
    .prepare(
      "SELECT sequence, chunk_key AS chunkKey, content FROM agent_session_chunks WHERE session_id = ? AND stream_type = 'raw' ORDER BY sequence"
    )
    .all(sessionId) as Array<{ sequence: number; chunkKey: string | null; content: string }>;
}

function rawBytes(db: Database.Database, sessionId = "s1"): number {
  return (
    db
      .prepare(
        "SELECT coalesce(sum(length(content)), 0) AS bytes FROM agent_session_chunks WHERE session_id = ? AND stream_type = 'raw'"
      )
      .get(sessionId) as { bytes: number }
  ).bytes;
}

/** A 100-byte ASCII line tagged with its index, so a row's origin is readable. */
const line = (i: number) => `${String(i).padStart(4, "0")}:${"x".repeat(94)}\n`;

function appendRaw(store: SessionChunkStore, from: number, to: number, sessionId = "s1") {
  for (let i = from; i < to; i++) {
    store.appendChunk({
      sessionId,
      streamType: "raw",
      content: line(i),
      chunkKey: `stdout:${i}`,
    });
  }
}

describe("raw stream cap", () => {
  const options = { maxBytes: 2000, keptHeadChunks: 3, trimToRatio: 0.5 };

  it("keeps a stream under the cap by dropping the oldest rows after the head", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, options);

    appendRaw(store, 0, 40); // 4,000 bytes offered against a 2,000-byte cap

    const rows = rawRows(db);
    // The head survives whole…
    expect(rows.slice(0, 3).map((r) => r.chunkKey)).toEqual(["stdout:0", "stdout:1", "stdout:2"]);
    // …then the marker, at the sequence of the first row ever dropped…
    expect(rows[3].chunkKey).toBe(SESSION_RAW_STREAM_TRIM_CHUNK_KEY);
    expect(rows[3].sequence).toBe(4);
    expect(isRawStreamTrimMarker(rows[3].content)).toBe(true);
    // …then the most recent rows, and the last one is always there.
    expect(rows[rows.length - 1].chunkKey).toBe("stdout:39");
    expect(rawBytes(db)).toBeLessThanOrEqual(options.maxBytes);
    // The order of what survives is the order it was written in.
    const kept = rows.slice(4).map((r) => Number(r.chunkKey!.slice("stdout:".length)));
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
  });

  it("trims in batches and rewrites the one marker rather than adding one per trim", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, options);

    // 21 rows = 2,100 bytes: the 21st append crosses the cap and trims.
    appendRaw(store, 0, 21);
    const firstMarker = rawRows(db).find((r) => r.chunkKey === SESSION_RAW_STREAM_TRIM_CHUNK_KEY)!;
    // Trimmed down to the target (plus the marker), not merely under the cap,
    // so the next appends do not trim one row at a time.
    expect(rawBytes(db)).toBeLessThanOrEqual(options.maxBytes * options.trimToRatio + 120);
    const rowsAfterFirstTrim = rawRows(db).length;
    appendRaw(store, 21, 25);
    expect(rawRows(db)).toHaveLength(rowsAfterFirstTrim + 4);

    appendRaw(store, 25, 60);
    const markers = rawRows(db).filter((r) => r.chunkKey === SESSION_RAW_STREAM_TRIM_CHUNK_KEY);
    expect(markers).toHaveLength(1);
    expect(markers[0].sequence).toBe(firstMarker.sequence);
    expect(markers[0].content).not.toBe(firstMarker.content);
    expect(markers[0].content).toMatch(/bytes in \d+ chunks dropped/);
    expect(rawBytes(db)).toBeLessThanOrEqual(options.maxBytes);
  });

  it("caps sessions independently and leaves output/response streams alone", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, options);

    appendRaw(store, 0, 40, "s1");
    appendRaw(store, 0, 5, "s2");
    for (let i = 0; i < 40; i++) {
      store.appendChunk({ sessionId: "s1", streamType: "output", content: line(i), chunkKey: `out:${i}` });
    }

    expect(rawRows(db, "s2")).toHaveLength(5);
    expect(rawRows(db, "s2").some((r) => r.chunkKey === SESSION_RAW_STREAM_TRIM_CHUNK_KEY)).toBe(false);
    const outputs = db
      .prepare("SELECT count(*) AS n FROM agent_session_chunks WHERE session_id = 's1' AND stream_type = 'output'")
      .get() as { n: number };
    expect(outputs.n).toBe(40);
  });

  it("seeds the running total from what SQLite already holds", () => {
    const db = createTestDb();
    // Written by a previous process, or before the cap existed.
    appendRaw(createSessionChunkStore(db, { maxBytes: 1_000_000 }), 0, 15);
    expect(rawRows(db)).toHaveLength(15);

    // A fresh store (new process) must count those 1,500 bytes at once.
    const store = createSessionChunkStore(db, options);
    appendRaw(store, 15, 20);
    expect(rawBytes(db)).toBeLessThanOrEqual(options.maxBytes);
    expect(rawRows(db).some((r) => r.chunkKey === SESSION_RAW_STREAM_TRIM_CHUNK_KEY)).toBe(true);
  });

  it("still dedupes a repeated provider key without counting it twice", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, options);
    appendRaw(store, 0, 5);
    const again = store.appendChunk({ sessionId: "s1", streamType: "raw", content: line(0), chunkKey: "stdout:0" });
    expect(again.inserted).toBe(false);
    expect(rawBytes(db)).toBe(500);
  });
});

describe("tail readers", () => {
  it("listChunkTail returns the most recent chunks in ascending order under a budget", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, { maxBytes: 1_000_000 });
    appendRaw(store, 0, 30);

    const tail = store.listChunkTail("s1", "raw", { maxBytes: 450 });
    expect(tail.chunks.map((c) => c.chunkKey)).toEqual(["stdout:26", "stdout:27", "stdout:28", "stdout:29"]);
    expect(tail.firstSequence).toBe(27);
    expect(tail.lastSequence).toBe(30);
    expect(tail.hasEarlier).toBe(true);

    const whole = store.listChunkTail("s1", "raw", { limit: 100 });
    expect(whole.chunks).toHaveLength(30);
    expect(whole.hasEarlier).toBe(false);

    const empty = store.listChunkTail("s2", "raw");
    expect(empty.chunks).toEqual([]);
    expect(empty.firstSequence).toBeNull();
    expect(empty.hasEarlier).toBe(false);
  });

  it("listChunkTail always serves the most recent chunk, even over budget", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, { maxBytes: 1_000_000 });
    appendRaw(store, 0, 3);
    const tail = store.listChunkTail("s1", "raw", { maxBytes: 10 });
    expect(tail.chunks.map((c) => c.chunkKey)).toEqual(["stdout:2"]);
  });

  it("readTail joins the end of the stream and cuts to the character budget", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, { maxBytes: 1_000_000 });
    appendRaw(store, 0, 200);

    const tail = store.readTail("s1", "raw", 250)!;
    expect(tail).toHaveLength(250);
    expect(tail.endsWith(line(199))).toBe(true);
    // 250 characters reach back into line 197.
    expect(tail.startsWith(line(197).slice(-50))).toBe(true);

    expect(store.readTail("s2", "raw", 100)).toBeNull();
    expect(store.readTail("s1", "output", 100)).toBeNull();
  });

  it("readTail returns a short stream whole", () => {
    const db = createTestDb();
    const store = createSessionChunkStore(db, { maxBytes: 1_000_000 });
    appendRaw(store, 0, 2);
    expect(store.readTail("s1", "raw", 10_000)).toBe(line(0) + line(1));
  });
});
