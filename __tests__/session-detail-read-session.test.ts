/**
 * `lib/agent-sessions/read-session.ts` — the detail route's readers, lifted
 * out of the route (#156) so they can be called, and tested, without a
 * request. The route suites cover the HTTP contract; this pins that the
 * module stands on its own and keeps the project scope.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const { projects, agentSessions } = await import("@/lib/db/schema");
const { appendSessionChunk } = await import("@/lib/agent-sessions/chunks");
const { buildSessionDetail, sessionExistsInProject, toTailSeed, readChunkTail } =
  await import("@/lib/agent-sessions/read-session");

beforeEach(() => {
  db.delete(agentSessions).run();
  db.delete(projects).run();
  db.insert(projects).values({ id: "p1", name: "One" }).run();
  db.insert(projects).values({ id: "p2", name: "Two" }).run();
  db.insert(agentSessions)
    .values({
      id: "s1",
      projectId: "p1",
      status: "running",
      prompt: "secret prompt",
      lastNonEmptyText: "last line",
      createdAt: new Date().toISOString(),
    })
    .run();
});

describe("read-session", () => {
  it("keeps the project scope", () => {
    expect(sessionExistsInProject("p1", "s1")).toBe(true);
    expect(sessionExistsInProject("p2", "s1")).toBe(false);
    expect(buildSessionDetail("p2", "s1")).toBeNull();
  });

  it("builds the polled payload without the prompt or logs.json", () => {
    const detail = buildSessionDetail("p1", "s1");

    expect(detail).not.toBeNull();
    expect(detail).not.toHaveProperty("prompt");
    expect(detail).not.toHaveProperty("logs");
    expect(detail?.lastNonEmptyText).toBe("last line");
    const withPrompt = buildSessionDetail("p1", "s1", { prompt: true });
    expect(withPrompt?.prompt).toBe(
      "secret prompt"
    );
  });

  it("seeds the raw stream from its end, with both cursors", () => {
    for (let i = 0; i < 30; i++) {
      appendSessionChunk({ sessionId: "s1", streamType: "raw", content: `line-${i}\n` });
    }

    const seed = toTailSeed(
      readChunkTail("s1", "raw", { limit: 5, maxBytes: 64 * 1024 }).tail
    );

    expect(seed.chunks.map((chunk) => chunk.content)).toEqual(
      [25, 26, 27, 28, 29].map((i) => `line-${i}\n`)
    );
    expect(seed.nextAfter).toBe(seed.lastSequence);
    expect(seed.hasMore).toBe(false);
    expect(seed.firstSequence).toBe(seed.chunks[0].sequence);
    expect(seed.hasEarlier).toBe(true);
  });
});
