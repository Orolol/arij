import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
} from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import { GET, PUT } from "@/app/api/settings/webhooks/route";

/** GET performs two `.all()` reads: projects, then settings. */
function seedGet(projectRows: unknown[], settingRows: unknown[]) {
  dbMockState.allQueue.push(projectRows, settingRows);
}

describe("GET /api/settings/webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("lists every project with its configured URL", async () => {
    seedGet(
      [
        { id: "p1", name: "Arij" },
        { id: "p2", name: "Zeta" },
      ],
      [
        { key: "github_pat", value: JSON.stringify("ghp_secret") },
        {
          key: "webhook_url:p1",
          value: JSON.stringify("https://ntfy.sh/arij"),
        },
      ]
    );

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.webhooks).toEqual([
      { projectId: "p1", projectName: "Arij", url: "https://ntfy.sh/arij" },
      { projectId: "p2", projectName: "Zeta", url: "" },
    ]);
  });

  it("does not leak unrelated settings values", async () => {
    seedGet(
      [{ id: "p1", name: "Arij" }],
      [{ key: "github_pat", value: JSON.stringify("ghp_secret") }]
    );

    const json = await (await GET()).json();

    expect(JSON.stringify(json)).not.toContain("ghp_secret");
    expect(json.data.webhooks[0].url).toBe("");
  });

  it("drops a stored value that is no longer a valid http(s) URL", async () => {
    seedGet(
      [{ id: "p1", name: "Arij" }],
      [{ key: "webhook_url:p1", value: JSON.stringify("javascript:alert(1)") }]
    );

    const json = await (await GET()).json();

    expect(json.data.webhooks[0].url).toBe("");
  });

  it("returns an empty list when there are no projects", async () => {
    seedGet([], []);

    const json = await (await GET()).json();

    expect(json.data.webhooks).toEqual([]);
  });
});

describe("PUT /api/settings/webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("rejects a non-http(s) URL with a 400", async () => {
    const res = await PUT(
      mockJsonRequest({ projectId: "p1", url: "javascript:alert(1)" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details.url[0]).toContain("http://");
  });

  it("rejects a missing projectId with a 400", async () => {
    const res = await PUT(mockJsonRequest({ url: "https://ntfy.sh/a" }));

    expect(res.status).toBe(400);
  });

  it("404s for an unknown project", async () => {
    dbMockState.getQueue.push(null); // getProjectOr404

    const res = await PUT(
      mockJsonRequest({ projectId: "ghost", url: "https://ntfy.sh/a" })
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Project not found");
  });

  it("inserts a new webhook URL as a JSON-encoded settings row", async () => {
    dbMockState.getQueue.push({ id: "p1", name: "Arij" }); // project
    dbMockState.getQueue.push(null); // no existing settings row

    const res = await PUT(
      mockJsonRequest({ projectId: "p1", url: "  https://ntfy.sh/arij  " })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ projectId: "p1", url: "https://ntfy.sh/arij" });
    expect(dbMockState.insertCalls).toContainEqual(
      expect.objectContaining({
        key: "webhook_url:p1",
        value: JSON.stringify("https://ntfy.sh/arij"),
      })
    );
    expect(dbMockState.updateCalls).toHaveLength(0);
  });

  it("updates an existing webhook row instead of inserting", async () => {
    dbMockState.getQueue.push({ id: "p1", name: "Arij" });
    dbMockState.getQueue.push({
      key: "webhook_url:p1",
      value: JSON.stringify("https://old.example/hook"),
    });

    const res = await PUT(
      mockJsonRequest({ projectId: "p1", url: "https://ntfy.sh/new" })
    );

    expect(res.status).toBe(200);
    expect(dbMockState.insertCalls).toHaveLength(0);
    expect(dbMockState.updateCalls).toContainEqual(
      expect.objectContaining({ value: JSON.stringify("https://ntfy.sh/new") })
    );
  });

  it("clears the webhook when given an empty url", async () => {
    dbMockState.getQueue.push({ id: "p1", name: "Arij" });

    const res = await PUT(mockJsonRequest({ projectId: "p1", url: "   " }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ projectId: "p1", url: "" });
    expect(dbMockState.insertCalls).toHaveLength(0);
    expect(dbMockState.updateCalls).toHaveLength(0);
  });
});
