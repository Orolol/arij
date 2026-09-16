/**
 * Visual proofs outlive their worktree by design: `attachSessionArtifact`
 * copies each image into `data/sessions/<session>/artifacts/`. Nothing else
 * ever removes that copy — the retention routine only prunes chunks — so the
 * permanent delete paths that remove the owning session are the last chance
 * to unlink the bytes, and the only place that can.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { createTestDb } from "@/lib/db/test-utils";

let sessionsRoot: string;

function createInMemoryDb() {
  const { sqlite } = createTestDb();
  // The explicit row delete must not lean on the FK cascade: the pragma is
  // not guaranteed ON for every connection.
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    INSERT INTO projects (id, name) VALUES ('proj-1', 'Project 1');
    INSERT INTO epics (id, project_id, title) VALUES
      ('epic-1', 'proj-1', 'Epic 1'),
      ('epic-2', 'proj-1', 'Epic 2');
    INSERT INTO user_stories (id, epic_id, title) VALUES
      ('story-1', 'epic-1', 'Story 1');
    INSERT INTO agent_sessions (id, project_id, epic_id, user_story_id, status) VALUES
      ('sess-epic-1', 'proj-1', 'epic-1', NULL, 'completed'),
      ('sess-story-1', 'proj-1', 'epic-1', 'story-1', 'completed'),
      ('sess-epic-2', 'proj-1', 'epic-2', NULL, 'completed');
    INSERT INTO session_artifacts (id, agent_session_id, epic_id, filename, caption) VALUES
      ('art-1', 'sess-epic-1', 'epic-1', 'art-1.png', 'one'),
      ('art-2', 'sess-story-1', 'epic-1', 'art-2.png', 'two'),
      ('art-3', 'sess-epic-2', 'epic-2', 'art-3.png', 'three');
  `);
  return sqlite;
}

function writeArtifact(sessionId: string, filename: string): string {
  const directory = path.join(sessionsRoot, sessionId, "artifacts");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, filename);
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return file;
}

async function loadDeleteModule(sqlite: Database.Database) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  vi.doMock("@/lib/agent-sessions/session-paths", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("@/lib/agent-sessions/session-paths")>();
    return {
      ...actual,
      resolveSessionsRoot: (override?: string) =>
        actual.resolveSessionsRoot(override ?? sessionsRoot),
    };
  });
  return import("@/lib/planning/permanent-delete");
}

function count(sqlite: Database.Database, query: string): number {
  return (sqlite.prepare(query).get() as { count: number }).count;
}

beforeEach(() => {
  sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arij-artifacts-"));
});

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/agent-sessions/session-paths");
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
});

describe("permanent deletes and visual-proof files", () => {
  it("epic delete unlinks the artifacts of every removed session, and only those", async () => {
    const sqlite = createInMemoryDb();
    const epicFile = writeArtifact("sess-epic-1", "art-1.png");
    const storyFile = writeArtifact("sess-story-1", "art-2.png");
    const keptFile = writeArtifact("sess-epic-2", "art-3.png");
    // The session directory holds more than proofs (logs.json): only the
    // artifacts subtree is this path's to remove.
    const logs = path.join(sessionsRoot, "sess-epic-1", "logs.json");
    fs.writeFileSync(logs, "[]");

    const { deleteEpicPermanently } = await loadDeleteModule(sqlite);
    deleteEpicPermanently("proj-1", "epic-1");

    expect(fs.existsSync(epicFile)).toBe(false);
    expect(fs.existsSync(path.dirname(epicFile))).toBe(false);
    expect(fs.existsSync(storyFile)).toBe(false);
    expect(fs.existsSync(keptFile)).toBe(true);
    expect(fs.existsSync(logs)).toBe(true);
    expect(
      count(sqlite, "SELECT COUNT(*) AS count FROM session_artifacts WHERE id IN ('art-1', 'art-2')"),
    ).toBe(0);
    expect(
      count(sqlite, "SELECT COUNT(*) AS count FROM session_artifacts WHERE id = 'art-3'"),
    ).toBe(1);
  });

  it("story delete unlinks its sessions' artifacts", async () => {
    const sqlite = createInMemoryDb();
    const storyFile = writeArtifact("sess-story-1", "art-2.png");
    const epicFile = writeArtifact("sess-epic-1", "art-1.png");

    const { deleteUserStoryPermanently } = await loadDeleteModule(sqlite);
    deleteUserStoryPermanently("proj-1", "story-1");

    expect(fs.existsSync(storyFile)).toBe(false);
    expect(fs.existsSync(epicFile)).toBe(true);
    expect(
      count(sqlite, "SELECT COUNT(*) AS count FROM session_artifacts WHERE id = 'art-2'"),
    ).toBe(0);
  });

  it("keeps the files when the delete rolls back", async () => {
    const sqlite = createInMemoryDb();
    const epicFile = writeArtifact("sess-epic-1", "art-1.png");
    sqlite.exec(`
      CREATE TRIGGER fail_epic_delete BEFORE DELETE ON epics
      BEGIN SELECT RAISE(FAIL, 'epic-delete-blocked'); END;
    `);

    const { deleteEpicPermanently } = await loadDeleteModule(sqlite);
    expect(() => deleteEpicPermanently("proj-1", "epic-1")).toThrow(
      "epic-delete-blocked",
    );

    expect(fs.existsSync(epicFile)).toBe(true);
    expect(count(sqlite, "SELECT COUNT(*) AS count FROM session_artifacts")).toBe(3);
  });
});

describe("removeSessionArtifactDirectories", () => {
  it("refuses ids that are not a single path segment", async () => {
    vi.resetModules();
    const { removeSessionArtifactDirectories } = await import(
      "@/lib/agent-sessions/artifacts"
    );
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "arij-outside-"));
    const victim = path.join(outside, "artifacts");
    fs.mkdirSync(victim);
    const relative = path.relative(sessionsRoot, outside);

    const removed = removeSessionArtifactDirectories(
      [relative, "..", ".", "", "a/b"],
      { sessionsRoot },
    );

    expect(removed).toBe(0);
    expect(fs.existsSync(victim)).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("counts only directories that existed", async () => {
    vi.resetModules();
    const { removeSessionArtifactDirectories } = await import(
      "@/lib/agent-sessions/artifacts"
    );
    writeArtifact("sess-a", "x.png");

    expect(
      removeSessionArtifactDirectories(["sess-a", "sess-missing"], { sessionsRoot }),
    ).toBe(1);
    expect(fs.existsSync(path.join(sessionsRoot, "sess-a", "artifacts"))).toBe(false);
  });
});
