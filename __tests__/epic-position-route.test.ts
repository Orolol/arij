/**
 * GET/POST /api/projects/[projectId]/epics/[epicId]/position — the manual
 * re-ranking entry point that replaced the board's drag route.
 *
 * `epics.position` is Full Auto's execution-order contract: UP NEXT, the
 * registry and the supervisor all read it through `compareExecutionOrder`.
 * The server therefore owns the column order a move is computed against —
 * the client only says "up / down / top / bottom" — and every write goes
 * through the transactional core so the column comes out as 0..n-1.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const mockExport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: mockExport }));

const mockEmitUpdated = vi.hoisted(() => vi.fn());
vi.mock("@/lib/events/emit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/emit")>()),
  emitTicketUpdated: mockEmitUpdated,
}));

const { db } = await import("@/lib/db");
const { projects, epics, ticketActivityLog } = await import("@/lib/db/schema");
const { GET, POST } = await import(
  "@/app/api/projects/[projectId]/epics/[epicId]/position/route"
);

const PROJECT_ID = "proj-position";
const OTHER_PROJECT_ID = "proj-other";

function ctx(epicId: string, projectId = PROJECT_ID) {
  return { params: Promise.resolve({ projectId, epicId }) };
}

function getRequest() {
  return new Request("http://localhost/api", { method: "GET" }) as never;
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

function addEpic(
  id: string,
  status: string,
  position: number,
  projectId = PROJECT_ID,
  type = "feature",
): void {
  db.insert(epics)
    .values({
      id,
      projectId,
      title: id,
      status,
      type,
      priority: 0,
      position,
      createdAt: "2026-09-16T09:00:00.000Z",
      updatedAt: "2026-09-16T09:00:00.000Z",
    })
    .run();
}

/** Ids of one column in execution order, with their stored positions. */
function column(status: string, projectId = PROJECT_ID) {
  return db
    .select()
    .from(epics)
    .all()
    .filter((row) => row.projectId === projectId && row.status === status)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
    .map((row) => [row.id, row.position]);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.delete(ticketActivityLog).run();
  db.delete(epics).run();
  db.delete(projects).run();
  db.insert(projects)
    .values([
      { id: PROJECT_ID, name: "Position", gitRepoPath: "/repos/position" },
      { id: OTHER_PROJECT_ID, name: "Other", gitRepoPath: "/repos/other" },
    ])
    .run();
});

describe("GET position", () => {
  it("ranks the ticket 1-based inside its own column, bugs and features together", async () => {
    addEpic("a", "todo", 0);
    addEpic("bug", "todo", 1, PROJECT_ID, "bug");
    addEpic("c", "todo", 2);
    // Other columns and other projects never count toward the rank.
    addEpic("elsewhere", "backlog", 0);
    addEpic("foreign", "todo", 0, OTHER_PROJECT_ID);

    const res = await GET(getRequest(), ctx("bug"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { status: "todo", rank: 2, total: 3, movable: true },
    });
  });

  it("follows compareExecutionOrder on a malformed column (shared position, id tiebreak)", async () => {
    addEpic("b", "todo", 0);
    addEpic("a", "todo", 0);

    const res = await GET(getRequest(), ctx("b"));

    expect((await res.json()).data).toMatchObject({ rank: 2, total: 2 });
  });

  it.each(["backlog", "todo", "in_progress", "review", "to_merge"])(
    "reports %s as movable",
    async (status) => {
      addEpic("x", status, 0);
      const res = await GET(getRequest(), ctx("x"));
      expect((await res.json()).data.movable).toBe(true);
    },
  );

  it.each(["done", "released"])("reports %s as not movable", async (status) => {
    addEpic("x", status, 0);
    const res = await GET(getRequest(), ctx("x"));
    expect((await res.json()).data.movable).toBe(false);
  });

  it("404s an unknown ticket and a ticket of another project", async () => {
    addEpic("foreign", "todo", 0, OTHER_PROJECT_ID);

    const unknown = await GET(getRequest(), ctx("nope"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toHaveProperty("error");

    const crossProject = await GET(getRequest(), ctx("foreign"));
    expect(crossProject.status).toBe(404);
  });
});

describe("POST position", () => {
  it("moves a ticket up and rewrites the whole column 0..n-1", async () => {
    // Gapped positions: the rewrite normalises the column, not just two rows.
    addEpic("a", "todo", 3);
    addEpic("b", "todo", 7);
    addEpic("c", "todo", 9);

    const res = await POST(postRequest({ move: "up" }), ctx("c"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { status: "todo", rank: 2, total: 3, movable: true },
    });
    expect(column("todo")).toEqual([
      ["a", 0],
      ["c", 1],
      ["b", 2],
    ]);
    expect(mockExport).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockEmitUpdated).toHaveBeenCalledWith(
      PROJECT_ID,
      "c",
      expect.objectContaining({ position: 1 }),
    );
  });

  // The registry reads updatedAt for "updated … ago", "waiting since" and its
  // activity sort: one click must not make the whole column look fresh.
  it("stamps only the moved ticket as updated and writes only rows that change", async () => {
    addEpic("a", "todo", 0);
    addEpic("b", "todo", 1);
    addEpic("c", "todo", 2);
    const sqlite = (await import("@/lib/db")).sqlite as import("better-sqlite3").Database;
    const before = sqlite.prepare("SELECT total_changes() AS n").get() as { n: number };

    await POST(postRequest({ move: "up" }), ctx("c"));

    const after = sqlite.prepare("SELECT total_changes() AS n").get() as { n: number };
    const updatedAt = Object.fromEntries(
      db.select().from(epics).all().map((row) => [row.id, row.updatedAt]),
    );
    expect(updatedAt.a).toBe("2026-09-16T09:00:00.000Z");
    expect(updatedAt.b).toBe("2026-09-16T09:00:00.000Z");
    expect(updatedAt.c).not.toBe("2026-09-16T09:00:00.000Z");
    expect(column("todo")).toEqual([
      ["a", 0],
      ["c", 1],
      ["b", 2],
    ]);
    // b and c change position (2 writes), c is stamped (1) and the move is
    // journalled (1); a already sits at its index and is not rewritten.
    expect(after.n - before.n).toBe(4);
  });

  it("moves down, to the top and to the bottom", async () => {
    addEpic("a", "backlog", 0);
    addEpic("b", "backlog", 1);
    addEpic("c", "backlog", 2);
    addEpic("d", "backlog", 3);

    await POST(postRequest({ move: "down" }), ctx("a"));
    expect(column("backlog").map(([id]) => id)).toEqual(["b", "a", "c", "d"]);

    await POST(postRequest({ move: "top" }), ctx("d"));
    expect(column("backlog").map(([id]) => id)).toEqual(["d", "b", "a", "c"]);

    const res = await POST(postRequest({ move: "bottom" }), ctx("b"));
    expect((await res.json()).data).toMatchObject({ rank: 4, total: 4 });
    expect(column("backlog")).toEqual([
      ["d", 0],
      ["a", 1],
      ["c", 2],
      ["b", 3],
    ]);
  });

  it("never touches another column or another project", async () => {
    addEpic("a", "todo", 0);
    addEpic("b", "todo", 1);
    addEpic("backlogged", "backlog", 5);
    addEpic("foreign", "todo", 5, OTHER_PROJECT_ID);

    await POST(postRequest({ move: "top" }), ctx("b"));

    expect(column("backlog")).toEqual([["backlogged", 5]]);
    expect(column("todo", OTHER_PROJECT_ID)).toEqual([["foreign", 5]]);
  });

  it("treats up on the first and down on the last as a 200 no-op", async () => {
    addEpic("a", "todo", 4);
    addEpic("b", "todo", 8);

    const up = await POST(postRequest({ move: "up" }), ctx("a"));
    expect(up.status).toBe(200);
    expect((await up.json()).data).toEqual({
      status: "todo",
      rank: 1,
      total: 2,
      movable: true,
    });

    const down = await POST(postRequest({ move: "down" }), ctx("b"));
    expect(down.status).toBe(200);
    expect((await down.json()).data).toMatchObject({ rank: 2, total: 2 });

    // Nothing written, nothing exported, nothing announced.
    expect(column("todo")).toEqual([
      ["a", 4],
      ["b", 8],
    ]);
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockEmitUpdated).not.toHaveBeenCalled();
  });

  it("journals the manual move on the moved ticket without changing its status", async () => {
    addEpic("a", "todo", 0);
    addEpic("b", "todo", 1);

    await POST(postRequest({ move: "up" }), ctx("b"));

    const entries = db.select().from(ticketActivityLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      epicId: "b",
      fromStatus: "todo",
      toStatus: "todo",
      actor: "user",
    });
    expect(entries[0].reason).toMatch(/position/i);
  });

  it("409s a column where order does not matter", async () => {
    addEpic("a", "done", 0);
    addEpic("b", "done", 1);

    const res = await POST(postRequest({ move: "up" }), ctx("b"));

    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty("error");
    expect(column("done")).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("409s a released ticket", async () => {
    addEpic("shipped", "released", 0);
    const res = await POST(postRequest({ move: "top" }), ctx("shipped"));
    expect(res.status).toBe(409);
  });

  it("404s an unknown ticket and a ticket of another project", async () => {
    addEpic("foreign", "todo", 0, OTHER_PROJECT_ID);

    expect((await POST(postRequest({ move: "up" }), ctx("nope"))).status).toBe(404);
    const crossProject = await POST(postRequest({ move: "up" }), ctx("foreign"));
    expect(crossProject.status).toBe(404);
    expect(await crossProject.json()).toHaveProperty("error");
  });

  it.each([
    ["an unknown move", { move: "sideways" }],
    ["a missing move", {}],
    ["an absolute position", { move: "up", position: 0 }],
    ["malformed JSON", "{"],
  ])("400s %s", async (_label, body) => {
    addEpic("a", "todo", 0);
    addEpic("b", "todo", 1);

    const res = await POST(postRequest(body), ctx("b"));

    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(column("todo")).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });
});

describe("the drag-and-drop ordering surface is gone", () => {
  const root = process.cwd();

  it("no longer ships POST /epics/reorder", () => {
    expect(
      fs.existsSync(
        path.join(root, "app/api/projects/[projectId]/epics/reorder/route.ts"),
      ),
    ).toBe(false);
  });

  it("no longer names a \"drag\" source in the workflow core", () => {
    for (const file of ["lib/workflow/engine.ts", "lib/workflow/reorder.ts"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/"drag"/);
    }
  });
});
