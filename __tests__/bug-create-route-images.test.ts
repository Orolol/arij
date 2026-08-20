import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  mockJsonRequest,
  mockRouteContext,
  resetDbMockState,
} from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));

import { POST } from "@/app/api/projects/[projectId]/bugs/route";

/**
 * The write end of a bug's screenshots. The ticket panel can only render this
 * project's own uploads, so a path the panel would silently skip must not
 * reach the column in the first place.
 */
describe("bug create route images", () => {
  const shot = "data/uploads/proj-1/att-1-screenshot.png";

  function createBug(body: Record<string, unknown>) {
    return POST(mockJsonRequest(body), mockRouteContext({ projectId: "proj-1" }));
  }

  function insertedBug() {
    return dbMockState.insertCalls[0] as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("attaches the uploaded paths to the bug as JSON", async () => {
    const res = await createBug({
      title: "Board renders blank",
      images: [shot, "data/uploads/proj-1/att-2-console.png"],
    });

    expect(res.status).toBe(201);
    expect(insertedBug().images).toBe(
      JSON.stringify([shot, "data/uploads/proj-1/att-2-console.png"])
    );
    expect(insertedBug().type).toBe("bug");
  });

  it("stores null for a bug reported without a screenshot", async () => {
    await createBug({ title: "No screenshot" });

    expect(insertedBug().images).toBeNull();
  });

  it.each([
    ["a path outside the uploads directory", ["/etc/passwd"]],
    ["another project's upload", ["data/uploads/proj-2/shot.png"]],
    ["a traversal", ["data/uploads/proj-1/../../arij.db"]],
    ["a non-string member", [shot, 7]],
    ["a null member", [null]],
    ["an undefined member", [undefined]],
    ["a bare string instead of an array", shot],
    ["an object", { path: shot }],
  ])("rejects %s without inserting anything", async (_label, images) => {
    const res = await createBug({ title: "Crafted", images });

    expect(res.status).toBe(400);
    expect(dbMockState.insertCalls).toHaveLength(0);
  });

  it("names the offending entry so the caller can fix it", async () => {
    const res = await createBug({ title: "Crafted", images: ["/etc/passwd"] });

    await expect(res.json()).resolves.toEqual({
      error: 'Not an upload of this project: "/etc/passwd"',
    });
  });
});
