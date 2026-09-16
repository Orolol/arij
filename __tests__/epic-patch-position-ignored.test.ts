/**
 * PATCH /api/projects/[projectId]/epics/[epicId] no longer writes `position`.
 *
 * `position` is the per-column execution order Full Auto runs in, and the
 * only writer allowed to change it is the transactional core in
 * lib/workflow/reorder.ts (reached by POST .../position and the refinement
 * MCP tool), which rewrites the column 0..n-1. A raw PATCH could park two
 * tickets on the same slot and silently decide which one runs first.
 *
 * `updateEpicSchema` is a non-strict zod object, so an unknown key is
 * stripped rather than refused — the test has to prove the column is left
 * alone, not that the request fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));

const { db } = await import("@/lib/db");
const { projects, epics } = await import("@/lib/db/schema");
const { updateEpicSchema } = await import("@/lib/validation/schemas");
const { PATCH } = await import(
  "@/app/api/projects/[projectId]/epics/[epicId]/route"
);

const PROJECT_ID = "proj-patch-position";

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api", {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ projectId: PROJECT_ID, epicId: "e1" }) },
  );
}

beforeEach(() => {
  db.delete(epics).run();
  db.delete(projects).run();
  db.insert(projects)
    .values({ id: PROJECT_ID, name: "Patch", gitRepoPath: "/repos/patch" })
    .run();
  db.insert(epics)
    .values({ id: "e1", projectId: PROJECT_ID, title: "Old", status: "todo", position: 3 })
    .run();
});

describe("PATCH epic — position is not a writable field", () => {
  it("drops position from the parsed body", () => {
    const parsed = updateEpicSchema.safeParse({ title: "New", position: 0 });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("position");
  });

  it("applies the other fields and leaves the stored position untouched", async () => {
    const res = await patch({ title: "New", position: 0 });

    expect(res.status).toBe(200);
    const row = db.select().from(epics).all().find((epic) => epic.id === "e1")!;
    expect(row.title).toBe("New");
    expect(row.position).toBe(3);
  });

  it("does not write a position-only body either", async () => {
    const res = await patch({ position: 0 });

    expect(res.status).toBe(200);
    const row = db.select().from(epics).all().find((epic) => epic.id === "e1")!;
    expect(row.position).toBe(3);
  });
});
