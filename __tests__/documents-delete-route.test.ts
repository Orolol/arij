import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("fs", () => ({
  default: {
    existsSync: mockExistsSync,
    unlinkSync: mockUnlinkSync,
  },
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
}));

describe("DELETE /api/projects/[projectId]/documents/[documentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockExistsSync.mockReturnValue(false);
  });

  it("returns 404 when document is missing", async () => {
    dbMockState.getQueue = [null];

    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/documents/[documentId]/route"
    );

    const res = await DELETE(mockNextRequest({ method: "DELETE" }), mockRouteContext({ projectId: "proj-1", documentId: "doc-1" }));

    expect(res.status).toBe(404);
  });

  it("deletes text document DB record without touching filesystem", async () => {
    dbMockState.getQueue = [
      {
        id: "doc-1",
        projectId: "proj-1",
        kind: "text",
        imagePath: null,
      },
    ];

    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/documents/[documentId]/route"
    );

    const res = await DELETE(mockNextRequest({ method: "DELETE" }), mockRouteContext({ projectId: "proj-1", documentId: "doc-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(true);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("deletes image file and DB record for image documents", async () => {
    dbMockState.getQueue = [
      {
        id: "doc-1",
        projectId: "proj-1",
        kind: "image",
        imagePath: "data/documents/proj-1/doc-1-diagram.png",
      },
    ];
    mockExistsSync.mockReturnValue(true);

    const { DELETE } = await import(
      "@/app/api/projects/[projectId]/documents/[documentId]/route"
    );

    const res = await DELETE(mockNextRequest({ method: "DELETE" }), mockRouteContext({ projectId: "proj-1", documentId: "doc-1" }));

    expect(res.status).toBe(200);
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
  });
});
