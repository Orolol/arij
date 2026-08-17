import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";
import { projects, pullRequests } from "@/lib/db/schema";

// Pure Drizzle route — run it against a real in-memory database built from
// the full migration chain (house pattern, see inbox-api.test.ts).
const testDb = vi.hoisted(() => ({
  instance: null as ReturnType<
    typeof import("@/lib/db/test-utils").createTestDb
  > | null,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.db;
  },
  get sqlite() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.sqlite;
  },
}));

import { GET } from "@/app/api/projects/[projectId]/prs/route";

function db() {
  return testDb.instance!.db;
}

function seedProject(id: string): void {
  db().insert(projects).values({ id, name: `Project ${id}` }).run();
}

function seedPr(
  id: string,
  projectId: string,
  number: number,
  status: string,
  createdAt: string
): void {
  db()
    .insert(pullRequests)
    .values({
      id,
      projectId,
      number,
      url: `https://github.com/owner/repo/pull/${number}`,
      title: `PR ${number}`,
      status,
      headBranch: `arij/${number}`,
      baseBranch: "main",
      createdAt,
    })
    .run();
}

async function callRoute(projectId: string) {
  const res = await GET(mockNextRequest(), mockRouteContext({ projectId }));
  return (await res.json()) as {
    data: Array<{ id: string; number: number; status: string }>;
  };
}

describe("GET /api/projects/[projectId]/prs", () => {
  beforeEach(() => {
    testDb.instance = createTestDb();
    seedProject("p1");
    seedProject("p2");
  });

  it("returns an empty list when the project has no pull requests", async () => {
    const body = await callRoute("p1");
    expect(body.data).toEqual([]);
  });

  it("returns only the still-open pull requests", async () => {
    seedPr("pr1", "p1", 128, "open", "2026-08-17 10:00:00");
    seedPr("pr2", "p1", 131, "draft", "2026-08-17 09:00:00");
    seedPr("pr3", "p1", 120, "merged", "2026-08-17 08:00:00");
    seedPr("pr4", "p1", 121, "closed", "2026-08-17 07:00:00");

    const body = await callRoute("p1");

    expect(body.data.map((pr) => pr.number)).toEqual([128, 131]);
    expect(body.data.every((pr) => pr.status !== "merged")).toBe(true);
  });

  it("returns the newest three at most", async () => {
    seedPr("pr1", "p1", 101, "open", "2026-08-11 10:00:00");
    seedPr("pr2", "p1", 102, "open", "2026-08-12 10:00:00");
    seedPr("pr3", "p1", 103, "open", "2026-08-13 10:00:00");
    seedPr("pr4", "p1", 104, "open", "2026-08-14 10:00:00");

    const body = await callRoute("p1");

    expect(body.data.map((pr) => pr.number)).toEqual([104, 103, 102]);
  });

  it("never leaks another project's pull requests", async () => {
    seedPr("pr1", "p1", 128, "open", "2026-08-17 10:00:00");
    seedPr("pr2", "p2", 999, "open", "2026-08-17 11:00:00");

    const body = await callRoute("p1");

    expect(body.data.map((pr) => pr.number)).toEqual([128]);
  });

  it("exposes the fields the status bar pills need", async () => {
    seedPr("pr1", "p1", 128, "open", "2026-08-17 10:00:00");

    const body = await callRoute("p1");

    expect(body.data[0]).toMatchObject({
      id: "pr1",
      number: 128,
      status: "open",
      url: "https://github.com/owner/repo/pull/128",
    });
  });
});
