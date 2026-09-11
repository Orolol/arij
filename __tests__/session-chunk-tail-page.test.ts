/**
 * The tail page of the chunk store, read backwards.
 *
 * The LIVE LOG opens on the END of the raw stream (`listChunkTail`) and walks
 * towards the head with a `before` cursor. The cursor has two halves, like the
 * forward page's `after`/`afterOffset`: the sequence of the earliest chunk
 * delivered, and how much of THAT chunk's head is still undelivered — non-zero
 * only when a chunk was too large for one page and only its end went out.
 *
 * Pinned here: every character of the stream is reachable walking backwards,
 * exactly once, including a legacy multi-megabyte row; no single chunk puts
 * more than the per-chunk cap on a page; and `hasEarlier` never confuses "the
 * page ended" with "the stream ended".
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  createSessionChunkStore,
  type SessionChunkStore,
} from "@/lib/agent-sessions/chunks";
import { countCharacters } from "@/lib/agent-sessions/session-detail";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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
  `);
  db.prepare("INSERT INTO agent_sessions (id) VALUES ('s1')").run();
  return db;
}

/**
 * Rows written straight into the table, past `appendChunk`: the write-path
 * caps would trim an oversized row, and the oversized rows the read path has
 * to handle are the legacy ones already in the live database.
 */
function seedRows(db: Database.Database, contents: string[], streamType = "raw") {
  const insert = db.prepare(
    "INSERT INTO agent_session_chunks (id, session_id, stream_type, sequence, chunk_key, content) VALUES (?, 's1', ?, ?, NULL, ?)"
  );
  contents.forEach((content, index) => {
    insert.run(`row-${index + 1}`, streamType, index + 1, content);
  });
}

function store(db: Database.Database): SessionChunkStore {
  return createSessionChunkStore(db, { maxBytes: Number.MAX_SAFE_INTEGER });
}

/** Walk the stream from its end to its head, the way the LIVE LOG does. */
function walkBackwards(
  s: SessionChunkStore,
  options: { limit?: number; maxBytes?: number; maxChunkBytes?: number }
) {
  let tail = s.listChunkTail("s1", "raw", options);
  const pages = [tail];
  for (let guard = 0; tail.hasEarlier && guard < 500; guard++) {
    tail = s.listChunkTail("s1", "raw", {
      ...options,
      before: tail.firstSequence,
      beforeOffset: tail.firstOffset,
    });
    pages.push(tail);
  }
  // Pages arrive newest-first; each page is itself ascending.
  const assembled = pages
    .reverse()
    .flatMap((page) => page.chunks.map((chunk) => chunk.content))
    .join("");
  return { assembled, pages };
}

describe("listChunkTail — before cursor", () => {
  it("serves the chunks strictly before `before`, ascending, under the budget", () => {
    const db = createTestDb();
    seedRows(db, Array.from({ length: 10 }, (_, i) => `line-${i}\n`));
    const s = store(db);

    const page = s.listChunkTail("s1", "raw", { before: 6, limit: 3 });

    expect(page.chunks.map((chunk) => chunk.sequence)).toEqual([3, 4, 5]);
    expect(page.firstSequence).toBe(3);
    expect(page.lastSequence).toBe(5);
    expect(page.firstOffset).toBe(0);
    expect(page.hasEarlier).toBe(true);

    const head = s.listChunkTail("s1", "raw", { before: 3, limit: 10 });
    expect(head.chunks.map((chunk) => chunk.sequence)).toEqual([1, 2]);
    expect(head.hasEarlier).toBe(false);
  });

  it("answers an empty, terminal page before the first chunk", () => {
    const db = createTestDb();
    seedRows(db, ["a", "b"]);
    const page = store(db).listChunkTail("s1", "raw", { before: 1 });

    expect(page.chunks).toEqual([]);
    expect(page.firstSequence).toBeNull();
    expect(page.hasEarlier).toBe(false);
  });

  it("reaches every character of the stream exactly once, walking backwards", () => {
    const db = createTestDb();
    const contents = Array.from({ length: 40 }, (_, i) => `${i}:${"z".repeat(i * 7)}\n`);
    seedRows(db, contents);

    const { assembled, pages } = walkBackwards(store(db), { limit: 4, maxBytes: 300 });

    expect(assembled).toBe(contents.join(""));
    expect(pages.length).toBeGreaterThan(3);
  });
});

describe("listChunkTail — bounded chunks", () => {
  it("serves an oversized most-recent chunk as its END, with the offset cursor", () => {
    const db = createTestDb();
    const blob = Array.from({ length: 5_000 }, (_, i) =>
      String.fromCharCode(97 + (i % 26))
    ).join("");
    seedRows(db, ["first\n", blob]);

    const tail = store(db).listChunkTail("s1", "raw", { maxBytes: 1_000 });

    expect(tail.chunks).toHaveLength(1);
    const [chunk] = tail.chunks;
    expect(chunk.sequence).toBe(2);
    expect(chunk.contentLength).toBe(5_000);
    expect(chunk.contentTruncated).toBe(true);
    expect(chunk.content).toBe(blob.slice(-1_000));
    expect(chunk.contentOffset).toBe(4_000);
    // The head of that chunk is still to come, so there is something earlier
    // even though the row before it has not been touched yet.
    expect(tail.firstOffset).toBe(4_000);
    expect(tail.hasEarlier).toBe(true);
  });

  it("walks a legacy multi-megabyte row out backwards without losing a byte", () => {
    const db = createTestDb();
    const blob = Array.from({ length: 700_000 }, (_, i) =>
      String.fromCharCode(65 + (i % 26))
    ).join("");
    const contents = ["head|", blob, "|tail"];
    seedRows(db, contents);

    const { assembled, pages } = walkBackwards(store(db), {});

    expect(assembled).toBe(contents.join(""));
    // The per-chunk cap is what split the row — no page carried all of it.
    for (const page of pages) {
      for (const chunk of page.chunks) {
        expect(Buffer.byteLength(chunk.content, "utf8")).toBeLessThanOrEqual(256 * 1024);
      }
    }
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it("cuts on characters, never inside an astral code point", () => {
    const db = createTestDb();
    const emoji = "🙂".repeat(2_000);
    seedRows(db, [emoji]);

    const s = store(db);
    const tail = s.listChunkTail("s1", "raw", { maxBytes: 1_001 });
    const [chunk] = tail.chunks;

    // 1,001 bytes holds 250 four-byte emoji; the 251st would split.
    expect(chunk.content).toBe("🙂".repeat(250));
    // Offsets count code points, like SQLite `length()`/`substr()`.
    expect(chunk.contentOffset).toBe(2_000 - 250);
    expect(chunk.contentOffset + countCharacters(chunk.content)).toBe(chunk.contentLength);

    const { assembled } = walkBackwards(s, { maxBytes: 1_001 });
    expect(assembled).toBe(emoji);
  });
});
