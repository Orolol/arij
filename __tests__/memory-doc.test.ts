/**
 * Learned project memory — storage helpers (lib/documents/memory.ts) against
 * the real migrated schema via createTestDb:
 *
 *   - save/read round-trip (create then replace, single row per project),
 *   - hard cap enforced by truncation on write,
 *   - getProjectMemoryContent trims and nulls empty/missing content,
 *   - the 'memory' kind never leaks into listProjectTextDocuments
 *     (prompt reference documents filter kind = 'text'), so the memory doc
 *     cannot double-inject as a reference document.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-utils";
import { documents, projects } from "@/lib/db/schema";
import {
  enforceMemoryCap,
  getProjectMemoryContent,
  getProjectMemoryDoc,
  saveProjectMemory,
} from "@/lib/documents/memory";
import {
  MEMORY_DOC_FILENAME,
  MEMORY_DOC_KIND,
  PROJECT_MEMORY_MAX_CHARS,
} from "@/lib/documents/memory-constants";

type TestDb = ReturnType<typeof createTestDb>["db"];

let db: TestDb;
const PROJECT_ID = "proj-memory";

beforeEach(() => {
  db = createTestDb().db;
  db.insert(projects).values({ id: PROJECT_ID, name: "Memory Project" }).run();
});

describe("saveProjectMemory / getProjectMemoryDoc", () => {
  it("creates the memory document on first save", () => {
    const { doc, truncated } = saveProjectMemory(
      PROJECT_ID,
      "## Conventions\n\n- Use createId for ids",
      db
    );

    expect(truncated).toBe(false);
    expect(doc.kind).toBe(MEMORY_DOC_KIND);
    expect(doc.originalFilename).toBe(MEMORY_DOC_FILENAME);
    expect(doc.markdownContent).toContain("Use createId");
    expect(doc.projectId).toBe(PROJECT_ID);

    const loaded = getProjectMemoryDoc(PROJECT_ID, db);
    expect(loaded?.id).toBe(doc.id);
  });

  it("replaces content in place on subsequent saves (single row)", () => {
    const first = saveProjectMemory(PROJECT_ID, "v1", db);
    const second = saveProjectMemory(PROJECT_ID, "v2", db);

    expect(second.doc.id).toBe(first.doc.id);
    expect(second.doc.markdownContent).toBe("v2");

    const rows = db
      .select()
      .from(documents)
      .where(eq(documents.projectId, PROJECT_ID))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("truncates content over the hard cap and reports it", () => {
    const oversized = "x".repeat(PROJECT_MEMORY_MAX_CHARS + 500);
    const { doc, truncated } = saveProjectMemory(PROJECT_ID, oversized, db);

    expect(truncated).toBe(true);
    expect(doc.markdownContent).toHaveLength(PROJECT_MEMORY_MAX_CHARS);
    expect(doc.sizeBytes).toBe(PROJECT_MEMORY_MAX_CHARS);
  });

  it("keeps memory docs per-project", () => {
    db.insert(projects).values({ id: "proj-other", name: "Other" }).run();
    saveProjectMemory(PROJECT_ID, "memory A", db);
    saveProjectMemory("proj-other", "memory B", db);

    expect(getProjectMemoryContent(PROJECT_ID, db)).toBe("memory A");
    expect(getProjectMemoryContent("proj-other", db)).toBe("memory B");
  });
});

describe("enforceMemoryCap", () => {
  it("is a no-op at or under the cap", () => {
    const exact = "y".repeat(PROJECT_MEMORY_MAX_CHARS);
    expect(enforceMemoryCap(exact)).toBe(exact);
    expect(enforceMemoryCap("short")).toBe("short");
  });

  it("cuts at exactly the cap", () => {
    const over = "z".repeat(PROJECT_MEMORY_MAX_CHARS + 1);
    expect(enforceMemoryCap(over)).toHaveLength(PROJECT_MEMORY_MAX_CHARS);
  });
});

describe("getProjectMemoryContent", () => {
  it("returns null when no memory document exists", () => {
    expect(getProjectMemoryContent(PROJECT_ID, db)).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    saveProjectMemory(PROJECT_ID, "   \n\n  ", db);
    expect(getProjectMemoryContent(PROJECT_ID, db)).toBeNull();
  });

  it("returns trimmed content", () => {
    saveProjectMemory(PROJECT_ID, "\n\n- rule\n\n", db);
    expect(getProjectMemoryContent(PROJECT_ID, db)).toBe("- rule");
  });
});

describe("kind discriminator isolation", () => {
  it("keeps the memory doc out of prompt reference documents (kind = 'text')", async () => {
    // listProjectTextDocuments reads the shared `db` from @/lib/db, so probe
    // the same predicate it uses directly against the test database.
    saveProjectMemory(PROJECT_ID, "durable conventions", db);
    db.insert(documents)
      .values({
        id: "doc-text",
        projectId: PROJECT_ID,
        originalFilename: "notes.md",
        kind: "text",
        markdownContent: "reference notes",
      })
      .run();

    const textRows = db
      .select()
      .from(documents)
      .where(eq(documents.kind, "text"))
      .all();
    expect(textRows.map((row) => row.originalFilename)).toEqual(["notes.md"]);

    const memoryRows = db
      .select()
      .from(documents)
      .where(eq(documents.kind, MEMORY_DOC_KIND))
      .all();
    expect(memoryRows).toHaveLength(1);
  });
});
