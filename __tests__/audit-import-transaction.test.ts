import { afterEach, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import { projects, epics } from "@/lib/db/schema";
const state = vi.hoisted(() => ({ instance: null as ReturnType<typeof createTestDb> | null }));
vi.mock("@/lib/db", () => ({ get db() { return state.instance!.db; } }));
vi.mock("@/lib/events/emit", () => ({ emitTicketMoved: vi.fn() }));
vi.mock("@/lib/sync/arji-json", () => ({ readArjiJson: async () => ({
  version: 1, lastSyncedAt: "2026-09-16T00:00:00Z",
  project: { name: "Changed", description: "Changed", status: "active", spec: "Changed" },
  epics: [{ id: "broken", title: "Cannot insert", description: null, priority: 0, status: "backlog", position: 0, branchName: null, type: "feature", user_stories: [] }],
}) }));
import { importArjiJson } from "@/lib/sync/import";
afterEach(() => state.instance?.sqlite.close());
it("rolls back project metadata when importing a ticket fails", async () => {
  state.instance = createTestDb();
  const { db, sqlite } = state.instance;
  db.insert(projects).values({ id: "p", name: "Original", gitRepoPath: "/tmp/repo" }).run();
  sqlite.exec("CREATE TRIGGER reject_import BEFORE INSERT ON epics BEGIN SELECT RAISE(ABORT, 'forced import failure'); END");
  await expect(importArjiJson("p")).rejects.toThrow("forced import failure");
  expect(db.select().from(projects).get()).toMatchObject({ name: "Original", description: null, spec: null });
  expect(db.select().from(epics).all()).toHaveLength(0);
});
