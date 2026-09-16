import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import { documents, projects } from "@/lib/db/schema";
import { resolveStoredPath } from "@/lib/storage/stored-path";
const state = vi.hoisted(() => ({ root: "", instance: null as ReturnType<typeof createTestDb> | null }));
vi.mock("@/lib/db", () => ({ get db() { return state.instance!.db; } }));
vi.mock("@/lib/documents/document-paths", () => ({
  documentImageAbsolutePath: (stored: unknown) => resolveStoredPath(state.root, "data/documents", stored),
  projectDocumentsDirectory: (id: string) => path.join(state.root, id),
}));
import { GET } from "@/app/api/projects/[projectId]/documents/[documentId]/image/route";
beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), "arij-image-test-"));
  fs.mkdirSync(path.join(state.root, "p"));
  state.instance = createTestDb();
  state.instance.db.insert(projects).values([{ id: "p", name: "Project" }, { id: "other", name: "Other" }]).run();
});
afterEach(() => { state.instance?.sqlite.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
function addImage(imagePath: string) {
  state.instance!.db.insert(documents).values({ id: "d", projectId: "p", originalFilename: "Image.png", kind: "image", imagePath }).run();
}
function getImage(projectId = "p") { return GET(new Request("http://localhost/image"), { params: Promise.resolve({ projectId, documentId: "d" }) }); }
it("serves a project's image with a restricted content policy", async () => {
  fs.writeFileSync(path.join(state.root, "p", "shot.png"), new Uint8Array([137, 80, 78, 71]));
  addImage("data/documents/p/shot.png");
  const response = await getImage();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
  expect((await getImage("other")).status).toBe(404);
});
it("refuses traversal and symlinks outside the owning project's directory", async () => {
  fs.writeFileSync(path.join(state.root, "outside.png"), "secret");
  fs.symlinkSync(path.join(state.root, "outside.png"), path.join(state.root, "p", "link.png"));
  addImage("data/documents/p/link.png");
  expect((await getImage()).status).toBe(404);
  expect(resolveStoredPath(state.root, "data/documents", "data/documents/../../outside.png")).toBeNull();
});
