// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { epics, projects, pullRequests } from "@/lib/db/schema";
import { GET } from "@/app/api/projects/[projectId]/epics/[epicId]/pr/route";
import { POST } from "@/app/api/projects/[projectId]/epics/[epicId]/pr/sync/route";

const fetchPrStatus = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github/pull-requests", () => ({ fetchPrStatus, createPullRequest: vi.fn(), generatePrBody: vi.fn() }));
vi.mock("@/lib/github/sync-log", () => ({ logSyncOperation: vi.fn() }));

const context = (projectId: string, epicId = "epic-b") => ({ params: Promise.resolve({ projectId, epicId }) });
beforeEach(() => {
  db.delete(projects).run();
  db.insert(projects).values([
    { id: "a", name: "A", githubOwnerRepo: "owner/a" },
    { id: "b", name: "B", githubOwnerRepo: "owner/b" },
  ]).run();
  db.insert(epics).values([{ id: "epic-a", projectId: "a", title: "A" }, { id: "epic-b", projectId: "b", title: "B" }]).run();
  db.insert(pullRequests).values({ id: "pr-b", projectId: "b", epicId: "epic-b", number: 42,
    url: "https://github.com/owner/b/pull/42", title: "B", headBranch: "feature-b", baseBranch: "main" }).run();
  fetchPrStatus.mockReset().mockResolvedValue({ status: "merged", title: "Synced B" });
});

describe("PR route project scope", () => {
  it("refuses to expose the PR of an epic owned by another project", async () => {
    const res = await GET(new NextRequest("http://localhost/pr"), context("a"));
    expect(res.status).toBe(404);
    expect((await res.json()).data).toBeUndefined();
  });

  it("refuses a cross-project sync before calling GitHub or modifying records", async () => {
    const res = await POST(new NextRequest("http://localhost/pr/sync", { method: "POST" }), context("a"));
    expect(res.status).toBe(404);
    expect(fetchPrStatus).not.toHaveBeenCalled();
    expect(db.select().from(pullRequests).where(eq(pullRequests.id, "pr-b")).get()?.status).toBe("open");
  });

  it("keeps valid absent, existing and synchronized PR responses", async () => {
    expect(await (await GET(new NextRequest("http://localhost/pr"), context("a", "epic-a"))).json()).toEqual({ data: null });
    expect((await (await GET(new NextRequest("http://localhost/pr"), context("b"))).json()).data.id).toBe("pr-b");
    const res = await POST(new NextRequest("http://localhost/pr/sync", { method: "POST" }), context("b"));
    expect(res.status).toBe(200);
    expect(fetchPrStatus).toHaveBeenCalledWith("owner", "b", 42);
    expect((await res.json()).data.status).toBe("merged");
  });
});
